// PENGAJUAN PEMAKAIAN BAHAN PRODUKSI (keputusan Owner, Nov 2026 — pilihan (a)).
//   • ADMIN mencatat → langsung (jalur lama). NON-ADMIN mencatat → divalidasi PENUH tanpa menulis (coba-saja), lalu disimpan sebagai PENGAJUAN: stok & HPP belum berubah.
//   • Verifikasi oleh ADMIN BERBEDA: dasar dihitung ulang (harga berlaku, aturan satuan, pemakaian bahan pada unit = indikator ganda, untuk V2 versi catatan & penyerahan Gudang);
//     berubah → DITAHAN untuk diperiksa (bisa disahkan dengan konfirmasi beralasan, tidak pernah diam-diam). Lalu jalur tulis LAMA dijalankan dengan pelaku = pengaju, kunci
//     idempotensi `pengajuan-<id>` (pengulangan/verifikasi ganda tidak membuat pergerakan ganda) dan waktu pemakaian = waktu pengajuan. Galat jalur lama (saldo, pengaman SO,
//     pembetulan, …) → DITAHAN beserta alasannya.
//   • Harga ambigu (pembetulan bertanggal yang harganya berubah pada hari itu) → ADMIN pun mengajukan; ADMIN lain mengesahkan dengan alasan dasar harga.
//   • Tolak / batal tidak mengubah stok atau HPP. Pengeluaran Gudang di luar pencatatan pemakaian Produksi TIDAK disentuh.
import crypto from "node:crypto";
import { adminBahan } from "./peranAdminBahan.js";
import { rolesOf } from "../middleware/authorize.js";
import { lockRowForUpdate } from "./inventoryLedger.js";
import { catatPemakaianHandler, jalankanCatatPemakaian } from "./catatPemakaianUnitV1.js";
import { hargaBerubahPadaHari, penyelesaiHargaBerlaku, batasHargaTanggal } from "./finance/hargaBerlaku.js";
import { unitSelesai } from "./pembetulanBahanUnit.js";
import { aturanUntukBahan } from "../lib/domain/satuanPakaiBahan.js";
import { muatAturanSatuanPakai } from "./satuanPakaiService.js";
import { prisma as prismaUtama } from "../db.js";
import { pemakaianBuktiSah, bahanBuktiBerlaku } from "./pemakaianBuktiSah.js";

export class PengajuanError extends Error {
  constructor(message, statusCode = 400, code = null, detail = null) { super(message); this.statusCode = statusCode; this.code = code; this.detail = detail; }
}
const wajib = (c, m, code, status = 400, detail = null) => { if (!c) throw new PengajuanError(m, status, code, detail); };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const r4 = (v) => Math.round(Number(v ?? 0) * 10000) / 10000;
// JSON STABIL (kunci diurutkan): dasar & masukan disimpan di jsonb yang mengubah urutan kunci — pembandingan harus tidak bergantung urutan.
const stabil = (x) => JSON.stringify(x, (k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((kk) => [kk, v[kk]])) : v));
const sama = (a, b) => stabil(a ?? null) === stabil(b ?? null);
const sha = (x) => crypto.createHash("sha256").update(stabil(x)).digest("hex");
const kunciDipakaiLain = () => new PengajuanError("Idempotency-Key ini sudah dipakai untuk isian yang berbeda", 409, "IDEMPOTENCY_KEY_REUSED");
const kunciEksekusi = (id) => `pengajuan-${id}`;
export const AKTIF = ["DIAJUKAN", "DITAHAN"];
export const JALUR = Object.freeze({ UNIT_BAHAN: "Catat pemakaian unit", PERUBAHAN: "Perubahan pemakaian unit", RUN_V2: "Bahan pekerjaan (Aplikasi Meja)", BUKTI_V2: "Bahan di bukti tahap (Aplikasi Meja)" });

/** Pengguna (id, nama, peran) untuk menjalankan jalur lama atas nama pengaju. */
async function muatPengguna(db, id) {
  const u = await db.user.findUnique({ where: { id }, select: { id: true, name: true, role: true, active: true } });
  wajib(u, "Pengaju tidak ditemukan", "PENGAJU_TIDAK_ADA", 409);
  const rows = await db.userRole.findMany({ where: { userId: id }, select: { role: true } });
  return { id: u.id, name: u.name, role: u.role, roles: rows.length ? rows.map((r) => r.role) : [u.role] };
}

/**
 * DASAR yang dibandingkan saat verifikasi (bukan saldo: saldo dicek CUKUP-TIDAKNYA oleh jalur tulis lama, karena saldo gudang bergerak sepanjang hari).
 * Per bahan: harga berlaku pada waktu dasar (id+harga), aturan satuan pakai, pemakaian bersih bahan itu pada unit (+ jumlah pergerakan) sebagai indikator catatan ganda/berubah.
 * RUN_V2: versi catatan bahan terakhir run, jumlah diserahkan Gudang per bahan, status retur sisa.
 */
async function hitungDasar(db, { jalur, unitId, runId, materialIds, tanggal = null, waktu }) {
  const sel = penyelesaiHargaBerlaku(db); const aturanSemua = await muatAturanSatuanPakai(db);
  const per = [];
  for (const mid of [...new Set(materialIds)].filter(Boolean).sort()) {
    const m = await db.material.findUnique({ where: { id: mid }, select: { id: true, code: true, name: true, unit: true } });
    if (!m) { per.push({ materialId: mid, ada: false }); continue; }
    const h = await sel(mid, tanggal ? batasHargaTanggal(tanggal) : new Date(waktu));
    const unitNet = await db.stockMovement.aggregate({ where: { unitId, materialId: mid, type: { in: ["ISSUE", "RETURN", "WASTE"] } }, _sum: { qty: true }, _count: { _all: true } });
    per.push({ materialId: mid, kode: m.code, satuan: m.unit, hargaId: h?.baris?.id ?? null, harga: h ? h.harga.toString() : null, aturan: aturanUntukBahan(m, aturanSemua) ?? null,
      pakaiUnit: r4(-Number(unitNet._sum.qty ?? 0)), gerakUnit: unitNet._count._all });
  }
  let run = null;
  if ((jalur === "RUN_V2" || jalur === "BUKTI_V2") && runId) {
    const [rec, plan] = await Promise.all([
      db.productionBuildMaterialRecord.findFirst({ where: { runId }, orderBy: { version: "desc" }, select: { version: true } }),
      db.productionRunPlan.findUnique({ where: { runId }, select: { id: true } }),
    ]);
    const issued = plan ? await db.materialIssueLine.findMany({ where: { materialIssue: { productionPlanId: plan.id, status: "ISSUED" } }, select: { materialId: true, issuedQty: true } }) : [];
    const ret = await db.productionMaterialReturn.findMany({ where: { runId }, select: { materialId: true, status: true } });
    const isu = {}; for (const l of issued) isu[l.materialId] = r4((isu[l.materialId] ?? 0) + Number(l.issuedQty || 0));
    run = { versiCatatan: rec?.version ?? 0, diserahkan: isu, returDiterima: ret.filter((r) => r.status !== "PENDING").map((r) => r.materialId).sort() };
  }
  return { jalur, per, run };
}
/** Perbedaan dasar yang berarti (dipakai untuk DITAHAN). */
function bandingDasar(a, b) {
  const beda = [];
  const pa = new Map((a.per ?? []).map((x) => [x.materialId, x])); const pb = new Map((b.per ?? []).map((x) => [x.materialId, x]));
  for (const [mid, x] of pa) {
    const y = pb.get(mid); if (!y) { beda.push({ jenis: "BAHAN", materialId: mid, pesan: "Bahan tidak lagi ditemukan" }); continue; }
    if (x.hargaId !== y.hargaId || x.harga !== y.harga) beda.push({ jenis: "HARGA", kode: x.kode, sebelum: x.harga, sesudah: y.harga, pesan: `Harga Berlaku ${x.kode} berubah (${x.harga ?? "kosong"} → ${y.harga ?? "kosong"})` });
    if (!sama(x.aturan, y.aturan)) beda.push({ jenis: "SATUAN", kode: x.kode, pesan: `Aturan satuan pakai ${x.kode} berubah` });
    if (x.pakaiUnit !== y.pakaiUnit || x.gerakUnit !== y.gerakUnit) beda.push({ jenis: "GANDA", kode: x.kode, sebelum: x.pakaiUnit, sesudah: y.pakaiUnit, pesan: `Pemakaian ${x.kode} pada unit berubah sejak diajukan (${x.pakaiUnit} → ${y.pakaiUnit}) — periksa kemungkinan dicatat dua kali` });
  }
  if (a.run || b.run) {
    if ((a.run?.versiCatatan ?? 0) !== (b.run?.versiCatatan ?? 0)) beda.push({ jenis: "GANDA", pesan: `Catatan bahan pekerjaan berubah sejak diajukan (versi ${a.run?.versiCatatan ?? 0} → ${b.run?.versiCatatan ?? 0})` });
    if (!sama(a.run?.diserahkan ?? {}, b.run?.diserahkan ?? {})) beda.push({ jenis: "SUMBER", pesan: "Jumlah bahan yang diserahkan Gudang untuk pekerjaan ini berubah sejak diajukan" });
    if ((b.run?.returDiterima ?? []).length) beda.push({ jenis: "SUMBER", pesan: "Retur sisa bahan pekerjaan ini sudah diterima Gudang — periksa manual sebelum mengubah pemakaian" });
  }
  // Hanya perubahan HARGA yang boleh disahkan dengan alasan tertulis (sesudah ditampilkan). Satuan, bahan, catatan ganda, dan sumber (penyerahan/retur Gudang) KERAS:
  // alasan bukan jalan melewatinya — tolak lalu ajukan ulang dengan dasar terbaru.
  return beda.map((b) => (b.jenis === "HARGA" ? b : { ...b, keras: true, pesan: `${b.pesan} — tidak bisa disahkan dengan alasan; tolak lalu ajukan ulang dengan dasar terbaru` }));
}

async function catatEvent(tx, pengajuanId, kind, actorId, reason = null, detail = null) {
  await tx.pengajuanPemakaianProduksiEvent.create({ data: { pengajuanId, kind, actorId: actorId ?? null, reason: reason ? String(reason).slice(0, 500) : null, detail } });
}
const tampil = (p) => ({ id: p.id, jalur: p.jalur, jalurLabel: JALUR[p.jalur], unitId: p.unitId, runId: p.runId, ringkasan: p.ringkasan, status: p.status, hargaAmbigu: p.hargaAmbigu,
  diajukanOleh: p.diajukanOleh, peranPengaju: p.peranPengaju, diajukanPada: p.diajukanPada, diputuskanOleh: p.diputuskanOleh, diputuskanPada: p.diputuskanPada, alasanKeputusan: p.alasanKeputusan,
  alasanTahan: p.alasanTahan, hasil: p.hasil });

/** Simpan pengajuan (idempoten per pengaju + kunci). RUN_V2: pengajuan lama yang masih menunggu untuk run yang sama digantikan (catatan V2 = keadaan lengkap terbaru). */
export async function ajukanPemakaian(prisma, user, { jalur, unitId, runId = null, materialIds, masukan, ringkasan, tanggal = null, hargaAmbigu = false }, { kunci }) {
  wajib(JALUR[jalur], "jalur pengajuan tidak dikenal", "JALUR_TIDAK_DIKENAL");
  wajib(UUID.test(String(unitId ?? "")), "unit tidak valid", "UNIT_TIDAK_VALID");
  const k = String(kunci || `auto-${crypto.randomUUID()}`).slice(0, 128);
  const ada = await prisma.pengajuanPemakaianProduksi.findUnique({ where: { diajukanOleh_idempotencyKey: { diajukanOleh: user.id, idempotencyKey: k } } });
  if (ada) { if (!sama(ada.masukan, masukan)) throw kunciDipakaiLain(); return { ulang: true, pengajuan: tampil(ada) }; }
  const waktu = new Date();
  const dasar = await hitungDasar(prisma, { jalur, unitId, runId, materialIds, tanggal, waktu });
  try {
    return await prisma.$transaction(async (tx) => {
      if (jalur === "RUN_V2" && runId) {
        const lama = await tx.pengajuanPemakaianProduksi.findMany({ where: { runId, jalur: "RUN_V2", status: { in: AKTIF } } });
        for (const p of lama) { if (await sudahDieksekusi(tx, p)) continue; await lockRowForUpdate(tx, "pengajuan_pemakaian_produksi", p.id); await tx.pengajuanPemakaianProduksi.update({ where: { id: p.id }, data: { status: "DIBATALKAN", diputuskanOleh: user.id, diputuskanPada: waktu, alasanKeputusan: "Digantikan pengajuan bahan pekerjaan yang lebih baru" } }); await catatEvent(tx, p.id, "DIGANTIKAN", user.id, "Digantikan pengajuan lebih baru"); }
      }
      const p = await tx.pengajuanPemakaianProduksi.create({ data: { jalur, unitId, runId, materialIds: [...new Set(materialIds)].filter(Boolean), masukan, ringkasan, dasar, sidikDasar: sha(dasar), hargaAmbigu,
        diajukanOleh: user.id, peranPengaju: rolesOf(user), diajukanPada: waktu, idempotencyKey: k } });
      await catatEvent(tx, p.id, "DIAJUKAN", user.id, null, { ringkasan, hargaAmbigu });
      return { ulang: false, pengajuan: tampil(p) };
    });
  } catch (e) {
    if (e?.code === "P2002") { const s = await prisma.pengajuanPemakaianProduksi.findUnique({ where: { diajukanOleh_idempotencyKey: { diajukanOleh: user.id, idempotencyKey: k } } }); if (s) return { ulang: true, pengajuan: tampil(s) }; }
    throw e;
  }
}

/** Bukti tahap 6/7/10 dari non-ADMIN: pengajuan dibuat di TRANSAKSI YANG SAMA dengan bukti (bukti & tahap tersimpan; jumlah bahan menunggu verifikasi). */
export async function ajukanBuktiDalamTx(tx, user, { run, evidence, stepNo, materials }) {
  wajib(user?.id, "Pengaju wajib ada", "PENGAJU_TIDAK_ADA", 401);
  const mats = materials.map((m) => ({ materialId: m.materialId, qty: r4(m.qty) }));
  const ids = [...new Set(mats.map((m) => m.materialId))];
  const waktu = new Date();
  const dasar = await hitungDasar(tx, { jalur: "BUKTI_V2", unitId: run.unitId, runId: run.id, materialIds: ids, waktu });
  const info = new Map((await tx.material.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true, unit: true } })).map((m) => [m.id, m]));
  const unit = await tx.unit.findUnique({ where: { id: run.unitId }, select: { unitCode: true, order: { select: { orderNumber: true } } } });
  const p = await tx.pengajuanPemakaianProduksi.create({ data: { jalur: "BUKTI_V2", unitId: run.unitId, runId: run.id, materialIds: ids, masukan: { evidenceId: evidence.id, stepNo, materials: mats },
    ringkasan: { unitKode: unit?.unitCode ?? null, orderNomor: unit?.order?.orderNumber ?? null, tahap: stepNo, baris: mats.map((m) => ({ materialId: m.materialId, kode: info.get(m.materialId)?.code ?? null, bahan: info.get(m.materialId)?.name ?? null, qty: m.qty, satuanStok: info.get(m.materialId)?.unit ?? null })) },
    dasar, sidikDasar: sha(dasar), hargaAmbigu: false, diajukanOleh: user.id, peranPengaju: rolesOf(user), diajukanPada: waktu, idempotencyKey: `bukti-${evidence.id}` } });
  await catatEvent(tx, p.id, "DIAJUKAN", user.id, null, { evidenceId: evidence.id, stepNo });
  return p;
}

/**
 * Eksekusi BUKTI_V2 dalam SATU transaksi: kunci pengajuan (harus aktif) → tolak bila retur sisa run SUDAH diterima Gudang (tidak pernah mengubah retur diterima diam-diam)
 * → tandai DISETUJUI (pemakaian kini sah) → periksa total pemakaian ≤ yang diserahkan → retur sisa PENDING disesuaikan. Stok berubah saat Gudang menerima retur (tepat sekali).
 */
async function eksekusiBukti(prisma, p, pengaju, keputusan) {
  const k = kunciEksekusi(p.id);
  const replay = async () => { const c = await prisma.v2Command.findUnique({ where: { actorId_idempotencyKey: { actorId: pengaju.id, idempotencyKey: k } } }); return c?.status === "APPLIED" ? { ok: true, hasil: c.response ?? {}, ditandai: true, ulang: true } : null; };
  try {
    return await prisma.$transaction(async (tx) => {
      const ada = await tx.v2Command.findUnique({ where: { actorId_idempotencyKey: { actorId: pengaju.id, idempotencyKey: k } } });
      if (ada?.status === "APPLIED") return { ok: true, hasil: ada.response ?? {}, ditandai: true, ulang: true };
      const cmd = await tx.v2Command.create({ data: { domain: "PRODUCTION", actorId: pengaju.id, idempotencyKey: k, commandType: "VERIFY_EVIDENCE_USAGE", aggregateType: "ProductionRun", aggregateId: p.runId, requestHash: sha({ pengajuan: p.id }) } });
      await penjagaAktif(p.id)(tx);
      const run = await tx.productionRun.findUnique({ where: { id: p.runId }, include: { unit: { select: { unitCode: true } } } });
      wajib(run, "Pekerjaan tidak ditemukan", "RUN_TIDAK_ADA", 404);
      const rets = await tx.productionMaterialReturn.findMany({ where: { runId: p.runId }, include: { material: { select: { code: true } } } });
      for (const x of rets) await lockRowForUpdate(tx, "production_material_returns_v2", x.id);
      const diterima = (await tx.productionMaterialReturn.findMany({ where: { runId: p.runId, status: { not: "PENDING" } }, include: { material: { select: { code: true } } } }));
      wajib(!diterima.length, `Retur sisa ${diterima.map((x) => `${x.material.code} ${Number(x.receivedQty ?? x.qty)}`).join(", ")} sudah DITERIMA Gudang sebelum pemakaian ini diverifikasi. Pemakaian tidak mengubah retur yang sudah diterima — tolak pengajuan ini; selisih fisik dibereskan Gudang (penerimaan kurang/waste) atau lewat koreksi.`, "BUILD_RETUR_SUDAH_DITERIMA", 409);
      await tx.pengajuanPemakaianProduksi.update({ where: { id: p.id }, data: { status: "DISETUJUI", diputuskanOleh: keputusan.adminId, diputuskanPada: new Date(), alasanKeputusan: keputusan.alasan, hasil: { evidenceId: p.masukan.evidenceId, returDisesuaikan: !!(rets.length || run.currentPhase === "HANDOFF") } } }); // satu kali: status final tidak bisa diperbarui lagi (trigger)
      // isi pengajuan per bahan tidak melebihi yang diserahkan Gudang (aturan yang sama dengan penyimpanan bukti: per bukti vs total diserahkan)
      const { issuedQtyByMaterial } = await import("./productionStepCommandService.js");
      const plan = await tx.productionRunPlan.findUnique({ where: { runId: p.runId }, select: { id: true } });
      const issued = await issuedQtyByMaterial(tx, plan?.id);
      for (const l of p.masukan.materials ?? []) { wajib(issued.has(l.materialId), "Bahan tidak lagi termasuk yang diserahkan Gudang untuk pekerjaan ini", "STEP_MATERIAL_NOT_ISSUED", 422); wajib(r4(l.qty) <= r4(issued.get(l.materialId)) + 0.00005, `Jumlah ${r4(l.qty)} melebihi yang diserahkan Gudang (${r4(issued.get(l.materialId))})`, "STEP_MATERIAL_OVER_ISSUED", 422); }
      let returDisesuaikan = false;
      if (rets.length || run.currentPhase === "HANDOFF") { const { createLeftoverReturnsInTx } = await import("./productionMaterialReturnService.js"); await createLeftoverReturnsInTx(tx, { run, actorId: pengaju.id, commandId: cmd.id }); returDisesuaikan = true; }
      const hasil = { evidenceId: p.masukan.evidenceId, returDisesuaikan, retur: returDisesuaikan ? (await tx.productionMaterialReturn.findMany({ where: { runId: p.runId }, select: { materialId: true, qty: true, status: true } })).map((x) => ({ materialId: x.materialId, qty: Number(x.qty), status: x.status })) : [] };
      await catatEvent(tx, p.id, "DISETUJUI", keputusan.adminId, keputusan.catatan, { hasil, ...keputusan.detail });
      await tx.v2Command.update({ where: { id: cmd.id }, data: { status: "APPLIED", response: hasil, completedAt: new Date() } });
      return { ok: true, hasil, ditandai: true };
    });
  } catch (e) {
    if (e?.code === "P2002") { const rp = await replay(); if (rp) return rp; }
    if (typeof e?.statusCode === "number") return { ok: false, galat: e.message, kode: e.code ?? null };
    throw e;
  }
}

// ───────────────────────────── EKSEKUTOR (jalur tulis lama) ─────────────────────────────
// Penjaga di DALAM transaksi tulis lama: pengajuan dikunci dan harus masih aktif. Bersama pemeriksaan "sudah dieksekusi" pada Tolak/Batal, verifikasi dan penolakan paralel
// tidak pernah berakhir dengan status DITOLAK/DIBATALKAN padahal pergerakan sudah tertulis.
const penjagaAktif = (id) => async (tx) => {
  await lockRowForUpdate(tx, "pengajuan_pemakaian_produksi", id);
  const s = await tx.pengajuanPemakaianProduksi.findUnique({ where: { id }, select: { status: true } });
  wajib(s && AKTIF.includes(s.status), `Pengajuan sudah diputuskan (${s?.status ?? "tidak ada"}) oleh ADMIN lain`, "PENGAJUAN_SUDAH_DIPUTUSKAN", 409);
};
async function sudahDieksekusi(tx, p) {
  return !!(await tx.v2Command.findUnique({ where: { actorId_idempotencyKey: { actorId: p.diajukanOleh, idempotencyKey: kunciEksekusi(p.id) } }, select: { id: true } }));
}
async function eksekusi(prisma, p, pengaju, keputusan) {
  const k = kunciEksekusi(p.id); const m = p.masukan; const penjaga = penjagaAktif(p.id);
  if (p.jalur === "BUKTI_V2") return eksekusiBukti(prisma, p, pengaju, keputusan);
  if (p.jalur === "UNIT_BAHAN") {
    const r = await jalankanCatatPemakaian({ user: pengaju, unitId: p.unitId, body: m.body, kunci: k, waktu: m.waktuBerjalan ? new Date(p.diajukanPada) : null, penjaga });
    if (r.status >= 400) return { ok: false, galat: r.body?.error ?? "Gagal", kode: r.body?.code ?? null };
    return { ok: true, hasil: { pergerakanId: r.body?.id ?? null, ulang: r.header["Idempotent-Replay"] === "true" } };
  }
  if (p.jalur === "PERUBAHAN") {
    const { terapkanPerubahanPemakaian } = await import("./perubahanPemakaianUnit.js");
    try { const h = await terapkanPerubahanPemakaian(prisma, pengaju, m.input, { kunci: k, diverifikasi: true, sekarang: new Date(p.diajukanPada), penjaga }); return { ok: true, hasil: h }; }
    catch (e) { if (typeof e?.statusCode === "number") return { ok: false, galat: e.message, kode: e.code ?? null }; throw e; }
  }
  if (p.jalur === "RUN_V2") {
    const { recordBuildMaterials } = await import("./productionBuildCommandService.js");
    const run = await prisma.productionRun.findUnique({ where: { id: p.runId }, select: { revision: true } });
    if (!run) return { ok: false, galat: "Pekerjaan tidak ditemukan", kode: "RUN_TIDAK_ADA" };
    try { const h = await recordBuildMaterials(prisma, { ...m.input, runId: p.runId, actorId: pengaju.id, idempotencyKey: k, expectedRevision: run.revision, dariPengajuan: true, penjaga }); return { ok: true, hasil: h }; }
    catch (e) { if (typeof e?.statusCode === "number" || typeof e?.status === "number") return { ok: false, galat: e.message, kode: e.code ?? null }; throw e; }
  }
  return { ok: false, galat: "jalur tidak dikenal", kode: "JALUR_TIDAK_DIKENAL" };
}

/**
 * Verifikasi BANYAK pengajuan; setiap pengajuan divalidasi sendiri dan hasilnya dilaporkan per baris (DISETUJUI | DITAHAN | DITOLAK_AKSES | GAGAL).
 * item = [{ id, konfirmasi?: alasan (untuk dasar yang berubah / pengajuan DITAHAN), konfirmasiHarga?: alasan (harga ambigu) }]
 */
export async function verifikasiPemakaian(prisma, admin, { item = [], catatan = null }) {
  wajib(adminBahan(admin), "Verifikasi pemakaian bahan hanya untuk peran ADMIN.", "TIDAK_BERWENANG", 403);
  wajib(Array.isArray(item) && item.length >= 1 && item.length <= 100, "Pilih 1–100 pengajuan", "PILIHAN_TIDAK_VALID");
  const hasil = [];
  for (const it of item) {
    try { hasil.push(await verifikasiSatu(prisma, admin, it, catatan)); }
    catch (e) { hasil.push({ id: it.id, status: "GAGAL", kode: e.code ?? null, pesan: e.message }); }
  }
  return { hasil, ringkas: { disetujui: hasil.filter((h) => h.status === "DISETUJUI").length, ditahan: hasil.filter((h) => h.status === "DITAHAN").length, gagal: hasil.filter((h) => !["DISETUJUI", "DITAHAN"].includes(h.status)).length } };
}

async function verifikasiSatu(prisma, admin, { id, konfirmasi = null, konfirmasiHarga = null }, catatan) {
  wajib(UUID.test(String(id ?? "")), "id tidak valid", "ID_TIDAK_VALID");
  // 1) periksa + hitung ulang dasar (terkunci)
  const cek = await prisma.$transaction(async (tx) => {
    await lockRowForUpdate(tx, "pengajuan_pemakaian_produksi", id);
    const p = await tx.pengajuanPemakaianProduksi.findUnique({ where: { id } });
    wajib(p, "Pengajuan tidak ditemukan", "TIDAK_ADA", 404);
    if (p.status === "DISETUJUI") return { selesai: true, p };
    wajib(AKTIF.includes(p.status), `Pengajuan berstatus ${p.status}`, "STATUS_FINAL", 409);
    wajib(p.diajukanOleh !== admin.id, "Pengaju tidak boleh memverifikasi pengajuannya sendiri — perlu ADMIN lain.", "PENYETUJU_SAMA_DENGAN_PENGAJU", 403);
    const alasanK = String(konfirmasi ?? "").trim(); const alasanH = String(konfirmasiHarga ?? "").trim();
    // Verifikasi paralel: ADMIN lain sudah menjalankan pengajuan ini (jejak perintah ada) — jangan hitung pergerakannya sebagai "ganda"; ulang eksekusi = replay idempoten.
    if (await sudahDieksekusi(tx, p)) return { lanjut: true, p, beda: [], alasanK, alasanH };
    if (p.hargaAmbigu && alasanH.length < 5) return { tahan: [{ jenis: "HARGA_AMBIGU", pesan: "Harga bahan berubah pada hari pemakaian: tulis alasan dasar harga (min. 5 karakter) untuk mengesahkan." }], p };
    const sekarangDasar = await hitungDasar(tx, { jalur: p.jalur, unitId: p.unitId, runId: p.runId, materialIds: p.materialIds, tanggal: p.masukan?.tanggal ?? null, waktu: p.diajukanPada });
    const beda = bandingDasar(p.dasar, sekarangDasar);
    // Perbedaan KERAS tidak pernah disahkan dengan alasan. Perbedaan HARGA disahkan hanya bila SUDAH DITAMPILKAN (pengajuan DITAHAN dengan perbedaan yang sama) + alasan tertulis.
    // Pengajuan yang dulu ditahan karena pemeriksaan eksekusi (saldo, SO, …) dan kini tanpa perbedaan dasar: dijalankan ulang — semua pemeriksaan tetap berjalan.
    if (beda.some((b) => b.keras)) return { tahan: beda, p };
    if (beda.length && !(p.status === "DITAHAN" && sama(p.alasanTahan?.beda ?? [], beda) && alasanK.length >= 5)) return { tahan: beda, p };
    return { lanjut: true, p, beda, alasanK, alasanH };
  });
  const tahan = async (pp, beda) => {
    const sudah = pp.status === "DITAHAN" && sama(pp.alasanTahan?.beda ?? [], beda);
    let kini = null;
    if (!sudah) kini = await prisma.$transaction(async (tx) => { await lockRowForUpdate(tx, "pengajuan_pemakaian_produksi", id); const s0 = await tx.pengajuanPemakaianProduksi.findUnique({ where: { id }, select: { status: true, hasil: true } }); if (!AKTIF.includes(s0.status)) return s0; await tx.pengajuanPemakaianProduksi.update({ where: { id }, data: { status: "DITAHAN", diputuskanOleh: admin.id, diputuskanPada: new Date(), alasanTahan: { beda } } }); await catatEvent(tx, id, "DITAHAN", admin.id, beda.map((b) => b.pesan).join("; "), { beda }); return null; });
    if (kini?.status === "DISETUJUI") return { id, status: "DISETUJUI", ulang: true, hasil: kini.hasil }; // disahkan ADMIN lain sementara itu
    if (kini) return { id, status: "GAGAL", kode: "STATUS_FINAL", pesan: `Pengajuan berstatus ${kini.status}` };
    return { id, status: "DITAHAN", beda };
  };
  if (cek.selesai) return { id, status: "DISETUJUI", ulang: true, hasil: cek.p.hasil };
  if (cek.tahan) return tahan(cek.p, cek.tahan);
  // 2) jalankan jalur lama atas nama pengaju (idempoten)
  const pengaju = await muatPengguna(prisma, cek.p.diajukanOleh);
  const alasanKeputusan = [catatan, cek.alasanK && cek.beda.length && `Dasar harga berubah, diperiksa: ${cek.alasanK}`, cek.alasanH && `Dasar harga: ${cek.alasanH}`].filter(Boolean).join(" | ").slice(0, 500) || null;
  const r = await eksekusi(prisma, cek.p, pengaju, { adminId: admin.id, alasan: alasanKeputusan, catatan, detail: { bedaDiperiksa: cek.beda, konfirmasi: cek.alasanK || null, konfirmasiHarga: cek.alasanH || null } });
  if (r.ok && r.ditandai) return { id, status: "DISETUJUI", ...(r.ulang ? { ulang: true } : {}), hasil: r.hasil };
  if (!r.ok && r.kode === "PENGAJUAN_SUDAH_DIPUTUSKAN") return { id, status: "GAGAL", kode: r.kode, pesan: r.galat };
  if (!r.ok) return tahan(cek.p, [{ jenis: "VALIDASI", kode: r.kode, pesan: `Ditolak pemeriksaan saat eksekusi: ${r.galat}` }]);
  // 3) tandai DISETUJUI (terkunci; verifikasi paralel oleh ADMIN lain sudah menandai → hasil sama, tanpa menulis ulang)
  const sudah = await prisma.$transaction(async (tx) => {
    await lockRowForUpdate(tx, "pengajuan_pemakaian_produksi", id);
    const kini = await tx.pengajuanPemakaianProduksi.findUnique({ where: { id }, select: { status: true, hasil: true } });
    if (kini.status === "DISETUJUI") return kini;
    wajib(AKTIF.includes(kini.status), `Pengajuan berstatus ${kini.status}`, "STATUS_FINAL", 409); // tidak terjadi: penjaga + Tolak/Batal menolak sesudah eksekusi
    await tx.pengajuanPemakaianProduksi.update({ where: { id }, data: { status: "DISETUJUI", diputuskanOleh: admin.id, diputuskanPada: new Date(), alasanKeputusan, hasil: r.hasil } });
    await catatEvent(tx, id, "DISETUJUI", admin.id, catatan, { hasil: r.hasil, bedaDiperiksa: cek.beda, konfirmasi: cek.alasanK || null, konfirmasiHarga: cek.alasanH || null });
  });
  return sudah ? { id, status: "DISETUJUI", ulang: true, hasil: sudah.hasil } : { id, status: "DISETUJUI", hasil: r.hasil };
}

/** Tolak banyak (ADMIN, bukan pengaju). Tidak mengubah stok/HPP. */
export async function tolakPemakaian(prisma, admin, { ids = [], alasan }) {
  wajib(adminBahan(admin), "Penolakan pemakaian bahan hanya untuk peran ADMIN.", "TIDAK_BERWENANG", 403);
  const t = String(alasan ?? "").trim(); wajib(t.length >= 5 && t.length <= 500, "Alasan penolakan wajib (5–500 karakter)", "ALASAN_WAJIB");
  const hasil = [];
  for (const id of ids) {
    try {
      hasil.push(await prisma.$transaction(async (tx) => {
        await lockRowForUpdate(tx, "pengajuan_pemakaian_produksi", id);
        const p = await tx.pengajuanPemakaianProduksi.findUnique({ where: { id } }); wajib(p, "Pengajuan tidak ditemukan", "TIDAK_ADA", 404);
        wajib(AKTIF.includes(p.status), `Pengajuan berstatus ${p.status}`, "STATUS_FINAL", 409);
        wajib(p.diajukanOleh !== admin.id, "Pengaju memakai Batalkan, bukan Tolak.", "PENYETUJU_SAMA_DENGAN_PENGAJU", 403);
        wajib(!(await sudahDieksekusi(tx, p)), "Pengajuan ini sedang/sudah dijalankan oleh verifikasi ADMIN lain — tidak bisa ditolak.", "SUDAH_DIEKSEKUSI", 409);
        await tx.pengajuanPemakaianProduksi.update({ where: { id }, data: { status: "DITOLAK", diputuskanOleh: admin.id, diputuskanPada: new Date(), alasanKeputusan: t } });
        await catatEvent(tx, id, "DITOLAK", admin.id, t);
        return { id, status: "DITOLAK" };
      }));
    } catch (e) { hasil.push({ id, status: "GAGAL", kode: e.code ?? null, pesan: e.message }); }
  }
  return { hasil };
}

/** Pengaju membatalkan pengajuannya sendiri selama belum diputuskan. */
export async function batalkanPemakaian(prisma, user, { id, alasan }) {
  const t = String(alasan ?? "").trim(); wajib(t.length >= 5 && t.length <= 500, "Alasan pembatalan wajib (5–500 karakter)", "ALASAN_WAJIB");
  return prisma.$transaction(async (tx) => {
    await lockRowForUpdate(tx, "pengajuan_pemakaian_produksi", id);
    const p = await tx.pengajuanPemakaianProduksi.findUnique({ where: { id } }); wajib(p, "Pengajuan tidak ditemukan", "TIDAK_ADA", 404);
    wajib(p.diajukanOleh === user.id, "Hanya pengaju yang bisa membatalkan pengajuannya", "BUKAN_PENGAJU", 403);
    wajib(AKTIF.includes(p.status), `Pengajuan berstatus ${p.status}`, "STATUS_FINAL", 409);
    wajib(!(await sudahDieksekusi(tx, p)), "Pengajuan ini sedang/sudah dijalankan oleh verifikasi ADMIN — tidak bisa dibatalkan.", "SUDAH_DIEKSEKUSI", 409);
    const s = await tx.pengajuanPemakaianProduksi.update({ where: { id }, data: { status: "DIBATALKAN", diputuskanOleh: user.id, diputuskanPada: new Date(), alasanKeputusan: t } });
    await catatEvent(tx, id, "DIBATALKAN", user.id, t);
    return tampil(s);
  });
}

/** Daftar pengajuan (antrean ADMIN, atau pengajuan tertunda per unit/run untuk operator & Nadya). Nama pengaju disertakan. */
export async function daftarPengajuan(db, { status = "DIAJUKAN,DITAHAN", unitId = null, runId = null, limit = 300 } = {}) {
  const st = String(status || "").split(",").map((s) => s.trim()).filter(Boolean);
  const rows = await db.pengajuanPemakaianProduksi.findMany({ where: { ...(st.length ? { status: { in: st } } : {}), ...(unitId ? { unitId } : {}), ...(runId ? { runId } : {}) }, orderBy: [{ diajukanPada: "asc" }], take: limit,
    include: { unit: { select: { unitCode: true, status: true, order: { select: { orderNumber: true } } } } } });
  const ids = [...new Set(rows.flatMap((r) => [r.diajukanOleh, r.diputuskanOleh]).filter(Boolean))];
  const nama = new Map((ids.length ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : []).map((u) => [u.id, u.name]));
  return rows.map((r) => ({ ...tampil(r), unitKode: r.unit.unitCode, statusUnit: r.unit.status, orderNomor: r.unit.order?.orderNumber ?? null, pengaju: nama.get(r.diajukanOleh) ?? null, pemutus: r.diputuskanOleh ? nama.get(r.diputuskanOleh) ?? null : null }));
}

export async function riwayatPengajuan(db, id) {
  wajib(UUID.test(String(id ?? "")), "id tidak valid", "ID_TIDAK_VALID");
  return db.pengajuanPemakaianProduksiEvent.findMany({ where: { pengajuanId: id }, orderBy: { createdAt: "asc" } });
}

// ───────────────────────────── GERBANG RUTE ─────────────────────────────
/** Harga ambigu = pembetulan unit terkirim bertanggal pemakaian yang Harga Berlakunya berubah pada hari itu. */
export async function hargaAmbiguPembetulan(db, { unitStatus, materialIds, tanggal }) {
  if (!unitSelesai(unitStatus) || !tanggal) return false;
  for (const mid of materialIds) if ((await hargaBerubahPadaHari(db, mid, tanggal)).length) return true;
  return false;
}

/** POST /units/:id/materials — ADMIN langsung; non-ADMIN (atau harga ambigu) → validasi tanpa menulis, lalu pengajuan 202. */
export async function gerbangCatatPemakaianUnit(req, res) {
  const db = prismaUtama; const user = req.user; const unitId = req.params.id; const body = req.body ?? {};
  const unit = UUID.test(String(unitId ?? "")) ? await db.unit.findUnique({ where: { id: unitId }, select: { id: true, unitCode: true, status: true, order: { select: { orderNumber: true } } } }) : null;
  const materialId = body.materialId; const tanggal = body.tanggalPemakaian ? String(body.tanggalPemakaian).slice(0, 10) : null;
  const ambigu = unit && UUID.test(String(materialId ?? "")) ? await hargaAmbiguPembetulan(db, { unitStatus: unit.status, materialIds: [materialId], tanggal }) : false;
  if (adminBahan(user) && !ambigu) return catatPemakaianHandler(req, res);
  const kunci = String(req.get("Idempotency-Key") || "").trim() || null;
  if (kunci && (kunci.length < 12 || kunci.length > 128)) return res.status(400).json({ error: "Idempotency-Key harus 12–128 karakter", code: "IDEMPOTENCY_KEY_INVALID" });
  if (kunci) { const ada = await db.pengajuanPemakaianProduksi.findUnique({ where: { diajukanOleh_idempotencyKey: { diajukanOleh: user.id, idempotencyKey: kunci } } }); if (ada && !sama(ada.masukan?.body, body)) return res.status(409).json({ error: "Idempotency-Key ini sudah dipakai untuk isian yang berbeda", code: "IDEMPOTENCY_KEY_REUSED" }); if (ada) return res.status(200).json({ menungguVerifikasi: true, ulang: true, pengajuan: tampil(ada) }); }
  const coba = await jalankanCatatPemakaian({ user, unitId, body, kunci: null, cobaSaja: true }); // seluruh pemeriksaan jalur lama, tanpa menulis
  if (coba.status >= 400) return res.status(coba.status).json(coba.body);
  const m = await db.material.findUnique({ where: { id: materialId }, select: { code: true, name: true, unit: true } });
  const r = await ajukanPemakaian(db, user, { jalur: "UNIT_BAHAN", unitId, materialIds: [materialId], tanggal: unitSelesai(unit.status) ? tanggal : null, hargaAmbigu: ambigu,
    masukan: { body, tanggal: unitSelesai(unit.status) ? tanggal : null, waktuBerjalan: !unitSelesai(unit.status) },
    ringkasan: { unitKode: unit.unitCode, orderNomor: unit.order?.orderNumber ?? null, baris: [{ kode: m?.code ?? null, bahan: m?.name ?? null, qty: Number(body.qty), satuanInput: body.satuan ?? m?.unit ?? null, satuanStok: m?.unit ?? null }], tanggal, catatan: body.note ?? null, pembetulan: unitSelesai(unit.status) } }, { kunci });
  return res.status(r.ulang ? 200 : 202).json({ menungguVerifikasi: true, ulang: r.ulang, pengajuan: r.pengajuan, pesan: ambigu && adminBahan(user) ? "Harga bahan berubah pada hari pemakaian: pencatatan ADMIN ini menunggu ADMIN lain mengesahkan dasar harganya." : "Pemakaian tercatat sebagai PENGAJUAN; stok dan HPP berubah sesudah diverifikasi ADMIN." });
}

/** POST /production/units/:id/perubahan-pemakaian — ADMIN langsung; non-ADMIN ganti bahan (atau ADMIN dengan harga ambigu) → pengajuan sesudah validasi rencana. */
export async function gerbangPerubahanPemakaian(prisma, user, input, { kunci, terapkan }) {
  const { rencanaPerubahan } = await import("./perubahanPemakaianUnit.js");
  const unit = UUID.test(String(input.unitId ?? "")) ? await prisma.unit.findUnique({ where: { id: input.unitId }, select: { status: true } }) : null;
  const tanggal = input.tanggalPemakaian ? String(input.tanggalPemakaian).slice(0, 10) : null;
  const ambigu = unit ? await hargaAmbiguPembetulan(prisma, { unitStatus: unit.status, materialIds: [input.materialId, input.keMaterialId].filter((x) => UUID.test(String(x ?? ""))), tanggal }) : false;
  if (adminBahan(user) && !ambigu) return { langsung: true, hasil: await terapkan() };
  const p = await rencanaPerubahan(prisma, user, { unitId: input.unitId, materialId: input.materialId, qtyBaru: input.qtyBaru, keMaterialId: input.keMaterialId, qtyKe: input.qtyKe, tanggalPemakaian: input.tanggalPemakaian, ajukan: false }, { diverifikasi: ambigu && adminBahan(user) });
  wajib(p.jalur === "LANGSUNG", "Perubahan jumlah ini diajukan lewat “Ajukan perubahan” (koreksi pemakaian, diverifikasi ADMIN).", "UNIT_PERLU_PERSETUJUAN", 409);
  wajib(!p.penghalang?.length, `Perubahan diblokir: ${p.penghalang?.[0]?.pesan}`, p.penghalang?.[0]?.kode ?? "PERUBAHAN_DIBLOKIR", 409, { penghalang: p.penghalang });
  const alasan = String(input.alasan ?? "").trim(); wajib(alasan.length >= 5 && alasan.length <= 500, "Alasan wajib diisi (5–500 karakter)", "UNIT_ALASAN_PEMBETULAN_WAJIB");
  wajib(input.dilihat && Array.isArray(input.dilihat.legs), "Lihat dampak dulu: pratinjau wajib dikirim.", "UNIT_PRATINJAU_WAJIB");
  const r = await ajukanPemakaian(prisma, user, { jalur: "PERUBAHAN", unitId: input.unitId, materialIds: [input.materialId, input.keMaterialId].filter(Boolean), tanggal: p.unit?.selesai ? tanggal : null, hargaAmbigu: ambigu,
    masukan: { input, tanggal: p.unit?.selesai ? tanggal : null },
    ringkasan: { unitKode: p.unit?.kode ?? null, orderNomor: p.unit?.order ?? null, mode: p.mode, teks: (p.ringkas ?? [])[0] ?? null, baris: (p.langkah ?? []).map((l) => ({ kode: l.bahan?.kode ?? null, bahan: l.bahan?.nama ?? null, qty: l.qty, satuanStok: l.bahan?.satuan ?? null, jenis: l.jenis })), tanggal, alasan } }, { kunci });
  return { langsung: false, menungguVerifikasi: true, ulang: r.ulang, pengajuan: r.pengajuan };
}

/** POST /production-v2/runs/:runId/build/materials — ADMIN langsung; non-ADMIN → validasi penuh (coba-saja) lalu pengajuan; operator tetap bisa menyelesaikan pekerjaan. */
//   Racikan & catatan TIDAK mengubah stok/HPP → dicatat LANGSUNG (dengan pemakaian terakhir yang sudah sah), supaya PIC Meja tidak tertahan "menunggu racikan".
//   Hanya perubahan PEMAKAIAN bahan yang menjadi pengajuan.
export async function gerbangBahanRunV2(prisma, user, input, { kunci, jalankan, cobaSaja, catatTanpaBahan }) {
  if (adminBahan(user)) return { langsung: true, hasil: await jalankan() };
  if (kunci) { // kirim ulang dengan kunci yang sama (revisi sudah naik karena racikan tercatat) = pengajuan yang sama
    const ada = await prisma.pengajuanPemakaianProduksi.findUnique({ where: { diajukanOleh_idempotencyKey: { diajukanOleh: user.id, idempotencyKey: String(kunci).slice(0, 128) } } });
    const masukanIni = { racikan: input.racikan ?? null, materials: input.materials ?? [], note: input.note ?? null };
    if (ada && !sama({ racikan: ada.masukan?.input?.racikan ?? null, materials: ada.masukan?.input?.materials ?? [], note: ada.masukan?.input?.note ?? null }, masukanIni)) throw kunciDipakaiLain();
    if (ada) return { langsung: false, menungguVerifikasi: true, ulang: true, pengajuan: tampil(ada), runId: ada.runId };
  }
  const coba = await cobaSaja(); // seluruh pemeriksaan (PIC Bahan ditugaskan, bahan dari penyerahan Gudang, tidak melebihi, terkunci) tanpa menulis
  if (coba && coba.cobaSaja !== true) return { langsung: true, hasil: coba }; // isi sama dengan catatan terakhir: tidak ada perubahan
  const terakhir = await prisma.productionBuildMaterialRecord.findFirst({ where: { runId: input.runId }, orderBy: { version: "desc" }, select: { materials: true } });
  const sah = (terakhir?.materials || []).map((m) => ({ materialId: m.materialId, qty: Number(m.qty) }));
  const sidikBahan = (xs) => JSON.stringify((xs || []).map((m) => [String(m?.materialId), Number(m?.qty)]).sort());
  if (sidikBahan(sah) === sidikBahan(input.materials)) return { langsung: true, hasil: await jalankan() }; // hanya racikan/catatan berubah
  if (input.racikan && catatTanpaBahan) await catatTanpaBahan(sah); // racikan langsung tercatat; pemakaian lama tetap berlaku sampai pengajuan disahkan
  const run = await prisma.productionRun.findUnique({ where: { id: input.runId }, select: { id: true, unitId: true, unit: { select: { unitCode: true, order: { select: { orderNumber: true } } } } } });
  wajib(run, "Pekerjaan tidak ditemukan", "RUN_TIDAK_ADA", 404);
  const mats = (input.materials ?? []).filter((m) => UUID.test(String(m?.materialId ?? "")));
  const info = new Map((mats.length ? await prisma.material.findMany({ where: { id: { in: mats.map((m) => m.materialId) } }, select: { id: true, code: true, name: true, unit: true } }) : []).map((m) => [m.id, m]));
  const r = await ajukanPemakaian(prisma, user, { jalur: "RUN_V2", unitId: run.unitId, runId: run.id, materialIds: mats.map((m) => m.materialId),
    masukan: { input: { racikan: input.racikan ?? null, materials: input.materials ?? [], note: input.note ?? null, canExecuteAny: !!input.canExecuteAny } },
    ringkasan: { unitKode: run.unit?.unitCode ?? null, orderNomor: run.unit?.order?.orderNumber ?? null, baris: mats.map((m) => ({ materialId: m.materialId, kode: info.get(m.materialId)?.code ?? null, bahan: info.get(m.materialId)?.name ?? null, qty: Number(m.qty), satuanStok: info.get(m.materialId)?.unit ?? null })), racikan: !!input.racikan, catatan: input.note ?? null } }, { kunci });
  return { langsung: false, menungguVerifikasi: true, ulang: r.ulang, pengajuan: r.pengajuan, runId: run.id };
}

// ───────────────────────────── UBAH PEMAKAIAN (permintaan Owner, Nov 2026) ─────────────────────────────
//   1) Pengajuan BELUM diverifikasi (DIAJUKAN/DITAHAN): tim produksi/QC mengubah LANGSUNG — pengajuan lama digantikan pengajuan baru dalam SATU transaksi (riwayat utuh).
//   2) SUDAH diverifikasi (DISETUJUI): boleh diubah juga — perubahan tersimpan sebagai pengajuan BARU yang menunggu verifikasi ulang ADMIN; angka yang sudah sah tetap
//      berlaku (stok/HPP tidak berubah) sampai perubahan itu disahkan. Pemakaian unit V1 yang sudah sah diubah dari tabel pemakaian (Ubah jumlah / Ganti bahan).
//   Semua pemeriksaan (saldo, satuan, penyerahan Gudang, catatan ganda, pengaman SO) tetap dijalankan untuk isi baru.
const barisBersih = (xs) => (Array.isArray(xs) ? xs : []).map((m) => ({ materialId: String(m?.materialId ?? ""), qty: r4(m?.qty) })).filter((m) => UUID.test(m.materialId) && m.qty > 0);

async function batalkanUntukDiubah(tx, lama, user, alasan, baruId) {
  await lockRowForUpdate(tx, "pengajuan_pemakaian_produksi", lama.id);
  const kini = await tx.pengajuanPemakaianProduksi.findUnique({ where: { id: lama.id }, select: { status: true } });
  wajib(AKTIF.includes(kini.status), `Pengajuan sudah ${kini.status} — muat ulang lalu ubah lagi`, "STATUS_FINAL", 409);
  wajib(!(await sudahDieksekusi(tx, lama)), "Pengajuan ini sedang diverifikasi ADMIN — tunggu sebentar lalu muat ulang.", "SUDAH_DIEKSEKUSI", 409);
  await tx.pengajuanPemakaianProduksi.update({ where: { id: lama.id }, data: { status: "DIBATALKAN", diputuskanOleh: user.id, diputuskanPada: new Date(), alasanKeputusan: `Diubah: ${alasan}`.slice(0, 500) } });
  await catatEvent(tx, lama.id, "DIUBAH", user.id, alasan, { diganti: baruId });
}

export async function ubahPengajuan(prisma, user, { id, baris = null, qty = null, satuan = undefined, note = undefined, alasan }) {
  wajib(UUID.test(String(id ?? "")), "id tidak valid", "ID_TIDAK_VALID");
  const why = String(alasan ?? "").trim(); wajib(why.length >= 5 && why.length <= 500, "Alasan perubahan wajib (5–500 karakter)", "ALASAN_WAJIB");
  const p = await prisma.pengajuanPemakaianProduksi.findUnique({ where: { id } });
  wajib(p, "Pengajuan tidak ditemukan", "TIDAK_ADA", 404);
  const aktif = AKTIF.includes(p.status);
  wajib(aktif || p.status === "DISETUJUI", `Pengajuan berstatus ${p.status} tidak bisa diubah — ajukan pemakaian baru`, "STATUS_FINAL", 409);
  const waktu = new Date(); const kunci = `ubah-${p.id}-${crypto.randomUUID()}`;

  if (p.jalur === "UNIT_BAHAN") {
    wajib(aktif, "Pemakaian ini sudah sah (tercatat di stok). Ubah dari tabel pemakaian unit (Ubah jumlah / Ganti bahan) — perubahan non-ADMIN menunggu verifikasi ADMIN.", "UBAH_LEWAT_TABEL", 409);
    const body = { ...p.masukan.body, ...(qty != null ? { qty: Number(qty) } : {}), ...(satuan !== undefined ? { satuan } : {}), ...(note !== undefined ? { note } : {}) };
    const coba = await jalankanCatatPemakaian({ user, unitId: p.unitId, body, kunci: null, cobaSaja: true });
    if (coba.status >= 400) throw new PengajuanError(coba.body?.error ?? "Isi baru ditolak pemeriksaan", coba.status, coba.body?.code ?? "VALIDASI_GAGAL");
    const unit = await prisma.unit.findUnique({ where: { id: p.unitId }, select: { status: true } });
    const tanggal = p.masukan?.tanggal ?? null;
    const hargaAmbigu = await hargaAmbiguPembetulan(prisma, { unitStatus: unit?.status, materialIds: [body.materialId], tanggal });
    const dasar = await hitungDasar(prisma, { jalur: p.jalur, unitId: p.unitId, runId: null, materialIds: [body.materialId], tanggal, waktu });
    const ringkasan = { ...p.ringkasan, baris: (p.ringkasan?.baris ?? []).map((b) => ({ ...b, qty: Number(body.qty), satuanInput: body.satuan ?? b.satuanInput })), catatan: body.note ?? null, diubahDari: p.id };
    return prisma.$transaction(async (tx) => {
      const baru = await tx.pengajuanPemakaianProduksi.create({ data: { jalur: p.jalur, unitId: p.unitId, runId: null, materialIds: p.materialIds, masukan: { ...p.masukan, body, diubahDari: p.id }, ringkasan, dasar, sidikDasar: sha(dasar), hargaAmbigu,
        diajukanOleh: user.id, peranPengaju: rolesOf(user), diajukanPada: waktu, idempotencyKey: kunci } });
      await batalkanUntukDiubah(tx, p, user, why, baru.id);
      await catatEvent(tx, baru.id, "DIAJUKAN", user.id, why, { diubahDari: p.id });
      return { diubah: true, menungguVerifikasi: true, pengajuan: tampil(baru), pesan: "Pemakaian diubah. Masih menunggu verifikasi ADMIN; stok dan HPP belum berubah." };
    });
  }

  if (p.jalur === "BUKTI_V2") {
    const mats = barisBersih(baris);
    wajib(mats.length >= 1 || Array.isArray(baris), "Isi bahan baru wajib", "BAHAN_WAJIB");
    // bahan HARUS dari yang diserahkan Gudang dan tidak melebihi (aturan yang sama dengan penyimpanan bukti); bukti yang diubah menggantikan isinya, tidak ditambahkan
    const { issuedQtyByMaterial } = await import("./productionStepCommandService.js");
    const plan = await prisma.productionRunPlan.findUnique({ where: { runId: p.runId }, select: { id: true } });
    const issued = await issuedQtyByMaterial(prisma, plan?.id);
    for (const l of mats) { wajib(issued.has(l.materialId), "Bahan harus dari yang sudah diserahkan Gudang untuk pekerjaan ini", "STEP_MATERIAL_NOT_ISSUED", 422); wajib(l.qty <= r4(issued.get(l.materialId)) + 0.00005, `Jumlah melebihi bahan yang diserahkan Gudang (${l.qty} > ${r4(issued.get(l.materialId))})`, "STEP_MATERIAL_OVER_ISSUED", 422); }
    const ids = [...new Set(mats.map((m) => m.materialId))];
    const dasar = await hitungDasar(prisma, { jalur: "BUKTI_V2", unitId: p.unitId, runId: p.runId, materialIds: ids, waktu });
    const info = new Map((ids.length ? await prisma.material.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true, unit: true } }) : []).map((m) => [m.id, m]));
    const ringkasan = { ...p.ringkasan, baris: mats.map((m) => ({ materialId: m.materialId, kode: info.get(m.materialId)?.code ?? null, bahan: info.get(m.materialId)?.name ?? null, qty: m.qty, satuanStok: info.get(m.materialId)?.unit ?? null })), diubahDari: p.id, ubahSesudahSah: !aktif };
    return prisma.$transaction(async (tx) => {
      const baru = await tx.pengajuanPemakaianProduksi.create({ data: { jalur: "BUKTI_V2", unitId: p.unitId, runId: p.runId, materialIds: ids, masukan: { evidenceId: p.masukan.evidenceId, stepNo: p.masukan.stepNo, materials: mats, diubahDari: p.id }, ringkasan, dasar, sidikDasar: sha(dasar), hargaAmbigu: false,
        diajukanOleh: user.id, peranPengaju: rolesOf(user), diajukanPada: waktu, idempotencyKey: kunci } });
      if (aktif) await batalkanUntukDiubah(tx, p, user, why, baru.id);
      else { // sudah sah: pengajuan perubahan lain yang masih menunggu untuk bukti yang sama digantikan (satu perubahan aktif per bukti)
        const lain = await tx.pengajuanPemakaianProduksi.findMany({ where: { runId: p.runId, jalur: "BUKTI_V2", status: { in: AKTIF }, id: { not: baru.id } } });
        for (const x of lain.filter((x) => x.masukan?.evidenceId === p.masukan.evidenceId)) await batalkanUntukDiubah(tx, x, user, why, baru.id);
        await catatEvent(tx, p.id, "DIUBAH", user.id, why, { perubahanMenunggu: baru.id });
      }
      await catatEvent(tx, baru.id, "DIAJUKAN", user.id, why, { diubahDari: p.id, sesudahSah: !aktif });
      return { diubah: true, menungguVerifikasi: true, pengajuan: tampil(baru), pesan: aktif ? "Pemakaian diubah. Masih menunggu verifikasi ADMIN; stok dan HPP belum berubah." : "Perubahan tersimpan dan diajukan untuk verifikasi ulang ADMIN. Angka yang sudah sah tetap berlaku sampai perubahan disahkan." };
    });
  }
  wajib(false, p.jalur === "RUN_V2" ? "Ubah bahan pekerjaan dari lembar \"Catat Racikan & Bahan\" (isian terakhir terbuka otomatis)." : "Perubahan pemakaian diubah dengan membatalkan lalu mengajukan ulang dari tabel pemakaian.", "UBAH_LEWAT_LEMBAR", 409);
}

/** Pemakaian bukti tahap yang SUDAH sah per run (untuk tombol Ubah sesudah verifikasi): pengajuan BUKTI_V2 DISETUJUI terakhir per bukti. */
export async function buktiTerverifikasi(db, runId) {
  const rows = await db.pengajuanPemakaianProduksi.findMany({ where: { runId, jalur: "BUKTI_V2", status: "DISETUJUI" }, orderBy: { diputuskanPada: "asc" } });
  const terakhir = new Map(); for (const r of rows) terakhir.set(r.masukan?.evidenceId, r);
  return [...terakhir.values()].map(tampil);
}
