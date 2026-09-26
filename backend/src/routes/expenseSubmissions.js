// PENGAJUAN BIAYA LINTAS DIVISI — endpoint HTTP. Workspace divisi (Delivery dulu, lalu
// divisi lain) hanya MEMBUAT, MELENGKAPI, dan MEMANTAU lewat sini. Approve/tolak/bayar/
// koreksi finansial TETAP di endpoint FinExpense yang sudah ada (financeTransactions.js) —
// lihat banner di schema.prisma#ExpenseSubmission.

import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { idempotency } from "../middleware/idempotency.js";
import { requireAnyPermission, PERMISSIONS as P, hasPermission, rolesOf } from "../middleware/authorize.js";
import { prisma } from "../db.js";
import { getWorkspaceConfig, daftarWorkspaceAktif, SUMBER_DANA, ARAHAN_MODUL_LAIN } from "../services/expenseSubmission/config.js";
import { bolehWorkspace, divisiTerlarang, bolehCatatAtasNama, workspaceUntukDivisi } from "../services/expenseSubmission/access.js";
import {
  buatPengajuan, ubahPengajuanDraft, ajukanPengajuan, tarikPengajuan, batalkanPengajuan,
  ubahMetadataPengajuan, cekKemungkinanDuplikat, submissionInclude, bentukSubmission, SubmissionError,
  mintaRevisiPengajuan, catatAudit,
} from "../services/expenseSubmission/service.js";
import {
  ownOnly, sanitasiBodyOwn, pastikanMilikSendiri, pastikanRelasiMilikSendiri, STATUS_EDITABLE_OWN,
} from "../services/expenseSubmission/ownAccess.js";
import { simpanFotoBukti } from "../services/finance/receipts.js";
import { daftarAktifUntuk } from "../services/finance/operationalAdvance.js";
import multer from "multer";

export const expenseSubmissionRouter = express.Router();
expenseSubmissionRouter.use("/expense-submissions", requireAuth, idempotency);

function err(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function handleErr(e, res) {
  if (e instanceof SubmissionError) return res.status(e.statusCode).json({ error: e.message });
  if (e?.statusCode) return res.status(e.statusCode).json({ error: e.message });
  if (e?.code === "P2002") return res.status(409).json({ error: "Data dengan kunci yang sama sudah ada" });
  if (e?.code === "P2025") return res.status(404).json({ error: "Data tidak ditemukan" });
  console.error("[expense-submission]", e);
  return res.status(500).json({ error: "Server error: " + e.message });
}

/** C1 — pengajuan Produksi/Gudang hanya untuk pemegang workspace-nya (atau staf Finance). Selain itu 404 (tidak membocorkan keberadaan). */
async function aksesBaris(req, id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) return;
  const row = await prisma.expenseSubmission.findUnique({ where: { id }, select: { division: true } });
  if (row && !bolehWorkspace(req.user, workspaceUntukDivisi(row.division))) throw err("Pengajuan tidak ditemukan", 404);
}

const CAN_SUBMIT = [P.FINANCE_POST, P.FINANCE_EXPENSE_SUBMIT, P.FINANCE_ADMIN];
// Jalur "milik sendiri" Driver/Helper/Leader Driver (delivery:expense:own:*) — DITAMBAH ke
// jalur lama, tidak menggantikannya. Route yang TIDAK memakai BACA/TULIS (uang-muka-aktif,
// duplicate-check, templates, recent, metadata) tetap hanya untuk CAN_SUBMIT.
const BACA = [...CAN_SUBMIT, P.DELIVERY_EXPENSE_OWN_READ];
const TULIS = [...CAN_SUBMIT, P.DELIVERY_EXPENSE_OWN_WRITE];

// Mutation dari akun own-only WAJIB membawa Idempotency-Key (middleware idempotency
// hanya mewajibkannya untuk token mobile; di sini berlaku untuk semua klien).
function wajibKunci(req) {
  if (ownOnly(req.user) && !req.headers["idempotency-key"]) {
    throw Object.assign(new Error("Header Idempotency-Key wajib untuk aksi biaya dari akun ini"), { statusCode: 428 });
  }
}

expenseSubmissionRouter.get("/expense-submissions/config", requireAnyPermission(...BACA), async (req, res) => {
  try {
    const workspace = String(req.query.workspace || "").toUpperCase();
    if (ownOnly(req.user) && workspace !== "DELIVERY") throw err("Akun ini hanya boleh memakai workspace DELIVERY", 403);
    const cfg = getWorkspaceConfig(workspace);
    if (!cfg) return res.status(404).json({ error: "Workspace tidak dikenal", tersedia: daftarWorkspaceAktif() });
    if (!bolehWorkspace(req.user, workspace)) throw err(`Anda tidak punya akses ke Pengajuan Biaya ${cfg.label}`, 403);
    res.json({
      workspace, division: cfg.division, label: cfg.label,
      expenseTypes: cfg.expenseTypes,
      relations: cfg.relations,
      relasiWajib: cfg.relasiWajib || {},
      wajibAlasanMendesak: cfg.wajibAlasanMendesak || [],
      arahanModulLain: cfg.division === "PRODUKSI" || cfg.division === "GUDANG" ? ARAHAN_MODUL_LAIN : [],
      requiresLeaderReview: cfg.requiresLeaderReview,
      metadataFieldsByType: Object.fromEntries(cfg.expenseTypes.map((t) => [t.code, cfg.metadataFields(t.code)])),
      // Ambang auto-approve adalah kebijakan Finance — tidak dibocorkan ke akun own-only.
      autoApprove: ownOnly(req.user) ? null : (cfg.autoApprove || null),
      sumberDana: SUMBER_DANA,
      // Boleh mengisi "requestedById" beda dari diri sendiri (catat atas nama
      // pengaju, D-181) — dihitung SERVER, frontend cuma menampilkan/menyembunyikan
      // berdasarkan ini, keputusan sesungguhnya tetap divalidasi ulang di service.js
      // setiap kali (tidak pernah dipercaya begitu saja dari klien).
      bolehCatatAtasNama: bolehCatatAtasNama(req.user, workspace),
    });
  } catch (e) { handleErr(e, res); }
});

expenseSubmissionRouter.get("/expense-submissions", requireAnyPermission(...BACA), async (req, res) => {
  try {
    const { status, q, from, to, vehicleId, jobId, limit, offset } = req.query;
    const hanyaOwn = ownOnly(req.user);
    // Akun own-only: DIPAKSA workspace DELIVERY + milik sendiri, apa pun query-nya.
    const division = hanyaOwn ? "DELIVERY" : req.query.division;
    const terlarang = divisiTerlarang(req.user);
    if (division && terlarang.includes(division)) throw err("Anda tidak punya akses ke pengajuan biaya divisi ini", 403);
    const hanyaMilikSendiri = hanyaOwn || (!hasPermission(req.user, P.FINANCE_READ) && !hasPermission(req.user, P.FINANCE_ADMIN));
    // Paginasi OPSIONAL & aditif: tanpa ?limit perilaku lama (maks 300) tidak berubah.
    const paged = limit !== undefined;
    const ambil = paged ? Math.min(Math.max(parseInt(limit, 10) || 30, 1), 100) : 300;
    const lewati = paged ? Math.max(parseInt(offset, 10) || 0, 0) : 0;
    const rows = await prisma.expenseSubmission.findMany({
      where: {
        ...(division ? { division } : (terlarang.length > 0 && { division: { notIn: terlarang } })),
        // status boleh satu nilai atau daftar dipisah koma (aditif): ?status=DIAJUKAN,MENUNGGU_PERSETUJUAN
        ...(status && { status: String(status).includes(",") ? { in: String(status).split(",").map((x) => x.trim()).filter(Boolean) } : status }),
        ...(vehicleId && { vehicleId }),
        ...(jobId && { jobId }),
        ...((from || to) && { date: { ...(from && { gte: new Date(from) }), ...(to && { lte: new Date(to) }) } }),
        ...(hanyaMilikSendiri && { OR: [{ requestedById: req.user.id }, { createdById: req.user.id }] }),
        ...(q && { OR: [{ submissionNumber: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }, { vendorName: { contains: q, mode: "insensitive" } }] }),
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: paged ? ambil + 1 : ambil,
      skip: lewati,
      // Daftar berpaginasi (klien mobile) TIDAK membawa riwayat audit per baris (hingga 50 x N baris);
      // riwayat lengkap ada di GET /:id. Tanpa ?limit perilaku lama tidak berubah.
      include: paged ? { ...submissionInclude, auditTrail: undefined } : submissionInclude,
    });
    const adaLagi = paged && rows.length > ambil;
    const halaman = adaLagi ? rows.slice(0, ambil) : rows;
    const bentuk = halaman.map(bentukSubmission);
    res.json({
      submissions: bentuk,
      total: bentuk.reduce((s, r) => s + r.amount, 0),
      hanyaMilikSendiri,
      terpotong: paged ? false : rows.length === 300,
      ...(paged && { limit: ambil, offset: lewati, adaLagi }),
    });
  } catch (e) { handleErr(e, res); }
});

// Uang muka aktif (saldo > 0) yang boleh dipilih untuk sumber dana "Uang muka operasional": milik pengaju sendiri
// dan/atau PIC. Finance/Dispatcher yang mencatat atas nama boleh menanyakan untuk pengaju lain.
expenseSubmissionRouter.get("/expense-submissions/uang-muka-aktif", requireAnyPermission(...CAN_SUBMIT), async (req, res) => {
  try {
    const bolehAtasNama = hasPermission(req.user, P.FINANCE_POST) || hasPermission(req.user, P.FINANCE_ADMIN) || rolesOf(req.user).includes("DISPATCHER");
    const pengaju = bolehAtasNama && req.query.requestedById ? String(req.query.requestedById) : req.user.id;
    const pic = req.query.picUserId ? String(req.query.picUserId) : null;
    res.json({ items: await daftarAktifUntuk(prisma, [pengaju, pic]) });
  } catch (e) { handleErr(e, res); }
});

expenseSubmissionRouter.get("/expense-submissions/duplicate-check", requireAnyPermission(...CAN_SUBMIT), async (req, res) => {
  try {
    const { division, vehicleId, expenseType, date, amount, excludeId, picUserId, workCenterId, warehouseId, unitId } = req.query;
    if (!division || !expenseType || !date) return res.json({ kandidat: [] });
    if (divisiTerlarang(req.user).includes(division)) throw err("Anda tidak punya akses ke pengajuan biaya divisi ini", 403);
    const kandidat = await cekKemungkinanDuplikat(prisma, {
      division, vehicleId: vehicleId || null, expenseType, date, amount, excludeId: excludeId || null, picUserId: picUserId || null,
      workCenterId: workCenterId || null, warehouseId: warehouseId || null, unitId: unitId || null,
    });
    res.json({ kandidat });
  } catch (e) { handleErr(e, res); }
});

expenseSubmissionRouter.get("/expense-submissions/templates", requireAnyPermission(...CAN_SUBMIT), async (req, res) => {
  try {
    const rows = await prisma.expenseSubmissionTemplate.findMany({ where: { ownerId: req.user.id }, orderBy: { createdAt: "desc" } });
    res.json({ templates: rows });
  } catch (e) { handleErr(e, res); }
});

expenseSubmissionRouter.post("/expense-submissions/templates", requireAnyPermission(...CAN_SUBMIT), async (req, res) => {
  try {
    const { label, division, payload } = req.body;
    if (!label?.trim()) throw err("Nama template wajib diisi");
    if (!division) throw err("Divisi wajib diisi");
    const created = await prisma.expenseSubmissionTemplate.create({ data: { ownerId: req.user.id, label: label.trim(), division, payload: payload || {} } });
    res.status(201).json(created);
  } catch (e) { handleErr(e, res); }
});

expenseSubmissionRouter.delete("/expense-submissions/templates/:id", requireAnyPermission(...CAN_SUBMIT), async (req, res) => {
  try {
    const t = await prisma.expenseSubmissionTemplate.findUnique({ where: { id: req.params.id }, select: { ownerId: true } });
    if (!t) throw err("Template tidak ditemukan", 404);
    if (t.ownerId !== req.user.id) throw err("Hanya pemilik template yang boleh menghapusnya", 403);
    await prisma.expenseSubmissionTemplate.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) { handleErr(e, res); }
});

// Pilihan terbaru (kendaraan/PIC/metode bayar) milik pengguna — kecepatan input (S7).
expenseSubmissionRouter.get("/expense-submissions/recent", requireAnyPermission(...CAN_SUBMIT), async (req, res) => {
  try {
    const { division } = req.query;
    const rows = await prisma.expenseSubmission.findMany({
      where: { requestedById: req.user.id, ...(division && { division }) },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        vehicleId: true, vehiclePlateSnapshot: true, picUserId: true, picNameSnapshot: true, driverId: true, driverNameSnapshot: true, paymentMethod: true, vendorName: true, expenseType: true, sumberDana: true,
        workCenter: { select: { id: true, name: true } }, warehouse: { select: { id: true, name: true } }, material: { select: { id: true, code: true, name: true } }, unit: { select: { id: true, unitCode: true } },
      },
    });
    const unik = (arr, key) => { const seen = new Set(); return arr.filter((x) => x[key] && !seen.has(x[key]) && seen.add(x[key])); };
    res.json({
      kendaraan: unik(rows, "vehicleId").map((r) => ({ id: r.vehicleId, label: r.vehiclePlateSnapshot })),
      pic: unik(rows, "driverId").map((r) => ({ id: r.driverId, label: r.driverNameSnapshot })),
      vendor: [...new Set(rows.map((r) => r.vendorName).filter(Boolean))],
      metodeBayar: [...new Set(rows.map((r) => r.paymentMethod).filter(Boolean))],
      // C1 — pilihan terakhir Produksi/Gudang untuk input cepat
      pilihanPic: unik(rows.map((r) => ({ id: r.picUserId, label: r.picNameSnapshot })), "id"),
      mesin: unik(rows.filter((r) => r.workCenter).map((r) => ({ id: r.workCenter.id, label: r.workCenter.name })), "id"),
      gudang: unik(rows.filter((r) => r.warehouse).map((r) => ({ id: r.warehouse.id, label: r.warehouse.name })), "id"),
      material: unik(rows.filter((r) => r.material).map((r) => ({ id: r.material.id, label: `${r.material.code} — ${r.material.name}` })), "id"),
      unit: unik(rows.filter((r) => r.unit).map((r) => ({ id: r.unit.id, label: r.unit.unitCode })), "id"),
      sumberDana: [...new Set(rows.map((r) => r.sumberDana).filter(Boolean))],
      jenisBiaya: [...new Set(rows.map((r) => r.expenseType).filter(Boolean))],
    });
  } catch (e) { handleErr(e, res); }
});

// C1 — pilihan tautan Produksi/Gudang (mesin, gudang, material, unit/order). Hanya untuk pemegang workspace-nya; tanpa data pelanggan.
expenseSubmissionRouter.get("/expense-submissions/opsi", requireAnyPermission(...CAN_SUBMIT), async (req, res) => {
  try {
    const workspace = String(req.query.workspace || "").toUpperCase();
    if (!["PRODUKSI", "WAREHOUSE"].includes(workspace)) throw err("Workspace tidak punya pilihan tautan", 400);
    if (!bolehWorkspace(req.user, workspace)) throw err("Anda tidak punya akses ke workspace ini", 403);
    const q = String(req.query.q || "").trim();
    const cari = q.length >= 2;
    const [mesin, gudang, material, unit, order] = await Promise.all([
      workspace === "PRODUKSI" ? prisma.workCenter.findMany({ where: { active: true }, select: { id: true, code: true, name: true }, orderBy: { name: "asc" }, take: 100 }) : [],
      workspace === "WAREHOUSE" ? prisma.warehouse.findMany({ where: { active: true }, select: { id: true, code: true, name: true }, orderBy: { name: "asc" }, take: 50 }) : [],
      workspace === "WAREHOUSE" && cari ? prisma.material.findMany({ where: { active: true, OR: [{ code: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }] }, select: { id: true, code: true, name: true, unit: true }, orderBy: { code: "asc" }, take: 20 }) : [],
      workspace === "PRODUKSI" && cari ? prisma.unit.findMany({ where: { unitCode: { contains: q, mode: "insensitive" } }, select: { id: true, unitCode: true, order: { select: { id: true, orderNumber: true } } }, orderBy: { unitCode: "desc" }, take: 20 }) : [],
      workspace === "PRODUKSI" && cari ? prisma.order.findMany({ where: { orderNumber: { contains: q, mode: "insensitive" } }, select: { id: true, orderNumber: true }, orderBy: { createdAt: "desc" }, take: 20 }) : [],
    ]);
    // Pengguna workspace (pemohon/PIC): peran yang relevan saja, hanya id & nama.
    const peran = workspace === "PRODUKSI" ? ["PRODUCTION_LEAD", "PRODUCTION_WORKER", "QC_LEAD"] : ["WAREHOUSE", "PRODUCTION_LEAD"];
    const pengguna = await prisma.user.findMany({ where: { active: true, OR: [{ role: { in: peran } }, { roles: { some: { role: { in: peran } } } }] }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 100 });
    res.json({ mesin, gudang, material, unit, order, pengguna });
  } catch (e) { handleErr(e, res); }
});

expenseSubmissionRouter.get("/expense-submissions/:id", requireAnyPermission(...BACA), async (req, res) => {
  try {
    const row = await prisma.expenseSubmission.findUnique({ where: { id: req.params.id }, include: submissionInclude });
    if (!row) throw err("Pengajuan tidak ditemukan", 404);
    if (ownOnly(req.user) && row.division !== "DELIVERY") throw err("Pengajuan tidak ditemukan", 404);
    if (!bolehWorkspace(req.user, workspaceUntukDivisi(row.division))) throw err("Pengajuan tidak ditemukan", 404);
    const hanyaMilikSendiri = !hasPermission(req.user, P.FINANCE_READ) && !hasPermission(req.user, P.FINANCE_ADMIN);
    if (hanyaMilikSendiri && row.requestedById !== req.user.id && row.createdById !== req.user.id) {
      throw err("Anda tidak punya akses ke pengajuan ini", 403);
    }
    res.json(bentukSubmission(row));
  } catch (e) { handleErr(e, res); }
});

expenseSubmissionRouter.post("/expense-submissions", requireAnyPermission(...TULIS), async (req, res) => {
  try {
    let workspace = String(req.body.workspace || "DELIVERY").toUpperCase();
    let body = req.body;
    // Urutan: otorisasi (403/404) lebih dulu, baru kelengkapan permintaan (428).
    if (ownOnly(req.user)) {
      if (workspace !== "DELIVERY") throw err("Akun ini hanya boleh mengajukan biaya Delivery", 403);
      body = sanitasiBodyOwn(body);
      wajibKunci(req);
      await pastikanRelasiMilikSendiri(prisma, req.user, body);
    }
    if (!bolehWorkspace(req.user, workspace)) throw err(`Anda tidak punya akses untuk mengajukan biaya ${getWorkspaceConfig(workspace)?.label || workspace}`, 403);
    const created = await buatPengajuan(prisma, { workspace, user: req.user, body });
    res.status(201).json(created);
  } catch (e) { handleErr(e, res); }
});

expenseSubmissionRouter.patch("/expense-submissions/:id", requireAnyPermission(...TULIS), async (req, res) => {
  try {
    await aksesBaris(req, req.params.id);
    let body = req.body;
    if (ownOnly(req.user)) {
      await pastikanMilikSendiri(prisma, req.params.id, req.user, { statusBoleh: STATUS_EDITABLE_OWN });
      body = sanitasiBodyOwn(body);
      wajibKunci(req);
      await pastikanRelasiMilikSendiri(prisma, req.user, body);
    }
    const updated = await ubahPengajuanDraft(prisma, { id: req.params.id, user: req.user, body });
    res.json(updated);
  } catch (e) { handleErr(e, res); }
});

expenseSubmissionRouter.post("/expense-submissions/:id/ajukan", requireAnyPermission(...TULIS), async (req, res) => {
  try {
    await aksesBaris(req, req.params.id);
    if (ownOnly(req.user)) { await pastikanMilikSendiri(prisma, req.params.id, req.user); wajibKunci(req); }
    const idemKey = req.headers["idempotency-key"] || null;
    const result = await ajukanPengajuan(prisma, { id: req.params.id, user: req.user, idemKey });
    res.json(result);
  } catch (e) { handleErr(e, res); }
});

expenseSubmissionRouter.post("/expense-submissions/:id/tarik", requireAnyPermission(...TULIS), async (req, res) => {
  try {
    await aksesBaris(req, req.params.id);
    if (ownOnly(req.user)) { await pastikanMilikSendiri(prisma, req.params.id, req.user); wajibKunci(req); }
    const result = await tarikPengajuan(prisma, { id: req.params.id, user: req.user });
    res.json(result);
  } catch (e) { handleErr(e, res); }
});

expenseSubmissionRouter.post("/expense-submissions/:id/batalkan", requireAnyPermission(...TULIS), async (req, res) => {
  try {
    await aksesBaris(req, req.params.id);
    if (ownOnly(req.user)) { await pastikanMilikSendiri(prisma, req.params.id, req.user); wajibKunci(req); }
    const result = await batalkanPengajuan(prisma, { id: req.params.id, user: req.user, reason: req.body?.reason });
    res.json(result);
  } catch (e) { handleErr(e, res); }
});

// Minta revisi — reviewer (finance:approve) mengembalikan pengajuan ke pemilik. Alasan wajib;
// Idempotency-Key wajib untuk semua klien; tidak tersedia bagi akun own-only.
expenseSubmissionRouter.post("/expense-submissions/:id/minta-revisi", requireAnyPermission(P.FINANCE_APPROVE), async (req, res) => {
  try {
    if (!req.headers["idempotency-key"]) throw err("Header Idempotency-Key wajib untuk meminta revisi", 428);
    const result = await mintaRevisiPengajuan(prisma, { id: req.params.id, user: req.user, reason: req.body?.reason });
    res.json(result);
  } catch (e) { handleErr(e, res); }
});

expenseSubmissionRouter.post("/expense-submissions/:id/metadata", requireAnyPermission(...CAN_SUBMIT), async (req, res) => {
  try {
    await aksesBaris(req, req.params.id);
    const result = await ubahMetadataPengajuan(prisma, { id: req.params.id, user: req.user, reason: req.body?.reason, changes: req.body?.changes });
    res.json(result);
  } catch (e) { handleErr(e, res); }
});

// Bukti/nota — VERSI baru tiap unggah (tidak overwrite), pola sama dengan Finance
// (simpanFotoBukti dari services/finance/receipts.js), bukan static publik Armada lama.
const uploadBukti = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
expenseSubmissionRouter.post("/expense-submissions/:id/bukti", requireAnyPermission(...TULIS), uploadBukti.single("bukti"), async (req, res) => {
  try {
    await aksesBaris(req, req.params.id);
    if (!req.file) throw err("File bukti wajib disertakan");
    // Bukti foto hanya boleh diganti pada pengajuan MILIK SENDIRI yang masih DRAF/PERLU_REVISI — untuk akun
    // own-only DAN pemegang izin pengajuan lama tanpa hak Finance. Staf Finance (finance:post / finance:admin)
    // tetap boleh melampirkan bukti kapan pun (perilaku lama). Tidak ada endpoint hapus bukti: mengganti = versi baru.
    const stafFinance = hasPermission(req.user, P.FINANCE_POST) || hasPermission(req.user, P.FINANCE_ADMIN);
    if (ownOnly(req.user) || !stafFinance) {
      // Akun own-only: hanya DELIVERY. Pemegang izin lama: milik sendiri di divisi manapun (perilaku multi-workspace utuh).
      await pastikanMilikSendiri(prisma, req.params.id, req.user, { statusBoleh: STATUS_EDITABLE_OWN, semuaDivisi: !ownOnly(req.user) });
      wajibKunci(req);
    }
    const s = await prisma.expenseSubmission.findUnique({ where: { id: req.params.id }, select: { id: true, requestedById: true, createdById: true } });
    if (!s) throw err("Pengajuan tidak ditemukan", 404);
    const { url } = await simpanFotoBukti(req.file.buffer);
    const versiTerakhir = await prisma.expenseSubmissionProof.findFirst({ where: { submissionId: s.id }, orderBy: { version: "desc" }, select: { version: true } });
    const [, proof] = await prisma.$transaction([
      prisma.expenseSubmissionProof.updateMany({ where: { submissionId: s.id, supersededAt: null }, data: { supersededAt: new Date() } }),
      prisma.expenseSubmissionProof.create({ data: { submissionId: s.id, url, version: (versiTerakhir?.version || 0) + 1, uploadedById: req.user.id } }),
    ]);
    await catatAudit(prisma, { submissionId: s.id, actorId: req.user.id, field: "bukti", before: versiTerakhir ? `versi ${versiTerakhir.version}` : null, after: `versi ${proof.version}`, reason: "Bukti foto diunggah" });
    res.status(201).json(proof);
  } catch (e) { handleErr(e, res); }
});

export default expenseSubmissionRouter;
