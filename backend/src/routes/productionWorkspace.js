// RUANG KERJA STATUS PRODUKSI — endpoint baca untuk Daftar Kerja (per order) dan header Ruang Kerja Unit. Dipasang di /api/production.
//   GET /work-list                  daftar order (aktif/riwayat) + unit di dalamnya, pencarian/filter/urutan/halaman di server
//   GET /units/:id/ruang-kerja      fakta header unit: order Sales, alur Meja (bila ada), ketersediaan Dokumentasi + alasan jujur bila tidak tersedia
// Isi lengkap (status kerja, rencana bahan, pemakaian aktual, riwayat) tetap dari GET /units/:id/adopsi; dokumentasi dari /api/production-v2/documentation/*. Tidak ada jalur tulis baru di sini.
import express from "express";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import multer from "multer";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission, hasPermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { wajibUuid } from "../lib/uuidParam.js";
import { pesanServerAman } from "../lib/galatServerAman.js";
import { PHASE_LABEL, RUN_STATUS_LABEL, listWorkList } from "../services/productionWorkListService.js";
import { UNIT_INCLUDE, perkayaBarisUnit } from "../services/productionOrderList.js";
import { perhatianUnit, tindakanTersedia } from "../lib/domain/productionWorkList.js";
import { displayStatusOfOrder, displayStatusOfUnit } from "../lib/domain/productionDisplay.js";
import { DOK_TAMBAHAN_MAKS_BYTES, DOK_TAMBAHAN_MAKS_FOTO, catatDokumentasiTambahan, daftarDokumentasiTambahan, putusanDokumentasiTambahan, statusDokumentasiTambahan } from "../services/unitDocumentationService.js";
import { PRODUCTION_READER_MODE, isProductionReaderEnabledFor, isProductionWriterEnabledFor, loadV2Flags, resolveProductionReaderState, resolveProductionWriterState } from "../services/v2FeatureFlags.js";

export const productionWorkspaceRouter = express.Router();
productionWorkspaceRouter.use(requireAuth);

function handleErr(err, res) {
  if (Number.isInteger(err?.statusCode) && err.code) return res.status(err.statusCode).json({ error: err.message, code: err.code });
  console.error("Produksi ruang kerja error:", err);
  return res.status(500).json({ error: pesanServerAman(err) });
}

productionWorkspaceRouter.get("/work-list", requirePermission(P.UNIT_READ), async (req, res) => {
  try { res.set("Cache-Control", "no-store"); res.json(await listWorkList(prisma, req.query)); } catch (err) { handleErr(err, res); }
});

const KELUHAN_LABEL = Object.freeze({ KEPALA_PUSING: "Kepala pusing", SAKIT_PINGGANG: "Sakit pinggang", SAKIT_PUNGGUNG: "Sakit punggung", SAKIT_LEHER: "Sakit leher", BAHU: "Bahu", PEGAL_PEGAL: "Pegal-pegal", SARAF_KEJEPIT: "Saraf kejepit", SKOLIOSIS: "Skoliosis", LAINNYA: "Lainnya" });
const tglKey = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const PESAN_DOK = Object.freeze({
  BELUM_ALUR: "Dokumentasi per kategori tersedia setelah unit masuk alur Meja (Rencana Produksi). Sampai saat itu hanya foto identitas unit yang bisa diunggah.",
  PEMBACA_MATI: "Dokumentasi belum menyala untuk unit ini. Hubungi Kepala Produksi.",
  DIBATALKAN: "Pekerjaan produksi unit ini dibatalkan; dokumentasi tidak bisa ditambah.",
  PENULIS_MATI: "Unggah dokumentasi belum menyala untuk unit ini. Hubungi Kepala Produksi.",
  HANYA_LIHAT: "Akun Anda hanya bisa melihat dokumentasi.",
});

productionWorkspaceRouter.get("/units/:id/ruang-kerja", requirePermission(P.UNIT_READ), wajibUuid(), async (req, res) => {
  try {
    const unit = await prisma.unit.findUnique({
      where: { id: req.params.id },
      select: {
        id: true, unitCode: true, merk: true, ukuran: true, status: true, orderId: true,
        order: { select: { id: true, orderNumber: true, status: true, statusLocked: true, healthStatus: true, complaintCategory: true, productionNote: true, hasComplaint: true, complaintDate: true, complaintDetail: true, complaintResolvedAt: true, customerPromiseDate: true, deliveryConfirmedDate: true, customer: { select: { id: true, name: true } }, items: { select: { layananName: true }, orderBy: { sortOrder: "asc" } }, units: { select: { id: true, unitCode: true, status: true }, orderBy: { seq: "asc" } } } },
      },
    });
    if (!unit) return res.status(404).json({ error: "Unit tidak ditemukan", code: "UNIT_TIDAK_ADA" });
    const run = await prisma.productionRun.findFirst({ where: { unitId: unit.id, status: { notIn: ["COMPLETED", "CANCELLED"] } }, orderBy: { createdAt: "desc" }, select: { id: true, status: true, currentPhase: true } })
      ?? await prisma.productionRun.findFirst({ where: { unitId: unit.id }, orderBy: { createdAt: "desc" }, select: { id: true, status: true, currentPhase: true } });
    const flags = await loadV2Flags(prisma);
    const bacaOn = resolveProductionReaderState(flags).mode !== PRODUCTION_READER_MODE.OFF && isProductionReaderEnabledFor(resolveProductionReaderState(flags), unit.id);
    const tulisOn = isProductionWriterEnabledFor(resolveProductionWriterState(flags), unit.id);
    const izinTulis = hasPermission(req.user, P.PRODUCTION_DOCUMENTATION_WRITE);
    let dokumentasi;
    if (!run) dokumentasi = { tersedia: false, runId: null, bolehUnggah: false, alasan: PESAN_DOK.BELUM_ALUR };
    else if (!bacaOn) dokumentasi = { tersedia: false, runId: run.id, bolehUnggah: false, alasan: PESAN_DOK.PEMBACA_MATI };
    else if (run.status === "CANCELLED") dokumentasi = { tersedia: true, runId: run.id, bolehUnggah: false, alasan: PESAN_DOK.DIBATALKAN };
    else if (!izinTulis) dokumentasi = { tersedia: true, runId: run.id, bolehUnggah: false, alasan: PESAN_DOK.HANYA_LIHAT };
    else if (!tulisOn) dokumentasi = { tersedia: true, runId: run.id, bolehUnggah: false, alasan: PESAN_DOK.PENULIS_MATI };
    else dokumentasi = { tersedia: true, runId: run.id, bolehUnggah: true, alasan: null };
    // Tindakan berikutnya yang benar-benar bisa dikerjakan di ruang kerja ini + perhatian utama (fakta tercatat) — sama dengan baris di Daftar kerja.
    const alurMeja = run && run.status !== "COMPLETED" && run.status !== "CANCELLED" ? { runId: run.id, status: run.status, statusLabel: RUN_STATUS_LABEL[run.status] ?? run.status, tahap: run.status === "PENDING_ARRIVAL" ? null : (PHASE_LABEL[run.currentPhase] ?? null) } : null;
    const baris = (await perkayaBarisUnit(prisma, [await prisma.unit.findUniqueOrThrow({ where: { id: unit.id }, include: UNIT_INCLUDE })]))[0];
    const tindakan = tindakanTersedia(baris.adopsi);
    const perhatian = perhatianUnit({ ...baris, alurMeja }, {});
    const tampilOrder = displayStatusOfOrder(unit.order.status);
    res.set("Cache-Control", "no-store");
    res.json({
      unit: { id: unit.id, unitCode: unit.unitCode, merk: unit.merk, ukuran: unit.ukuran, status: unit.status, statusUnit: displayStatusOfUnit(unit.status)?.label ?? null },
      order: {
        id: unit.order.id, orderNumber: unit.order.orderNumber, pelanggan: unit.order.customer, layanan: unit.order.items.map((i) => i.layananName).filter(Boolean),
        statusOrder: { key: tampilOrder?.key ?? null, label: tampilOrder?.label ?? String(unit.order.status), mentah: unit.order.status, terkunci: !!unit.order.statusLocked },
        jumlahUnit: unit.order.units.length, unitLain: unit.order.units.filter((u) => u.id !== unit.id),
        // Detail order untuk Produksi (informasi, baca-saja): kondisi pelanggan, catatan Sales untuk Produksi, komplain, janji. Dari kolom order yang sudah ada; tidak ditebak.
        detail: {
          kondisiPelanggan: unit.order.healthStatus === "SAKIT" ? { sakit: true, label: "Pelanggan sakit", keluhan: (unit.order.complaintCategory || []).map((k) => KELUHAN_LABEL[k] ?? k) } : unit.order.healthStatus === "TIDAK_SAKIT" ? { sakit: false, label: "Tidak sakit", keluhan: [] } : { sakit: null, label: "Belum diisi Sales", keluhan: [] },
          catatanProduksi: unit.order.productionNote || null,
          komplain: unit.order.hasComplaint ? { tanggal: tglKey(unit.order.complaintDate), rincian: unit.order.complaintDetail || null, selesai: !!unit.order.complaintResolvedAt } : null,
          janjiPelanggan: tglKey(unit.order.customerPromiseDate), pengirimanDikonfirmasi: tglKey(unit.order.deliveryConfirmedDate),
        },
      },
      alurMeja, tindakan, perhatian,
      dokumentasi,
      // Dokumentasi tambahan (14 Nov 2026): aktif hanya bila Dokumentasi V2 di atas tidak bisa menerima foto untuk unit ini.
      dokumentasiTambahan: putusanDokumentasiTambahan({ unitStatus: unit.status, run, bacaOn, tulisOn, izinTulis }),
      izin: { unggahDokumentasi: izinTulis, ubahStatusOrder: hasPermission(req.user, P.ORDER_WRITE), unggahFotoIdentitas: hasPermission(req.user, P.UNIT_ROUTING_WRITE) },
    });
  } catch (err) { handleErr(err, res); }
});

// ───────────────────────── Dokumentasi tambahan unit (14 Nov 2026) ─────────────────────────
//   GET  /units/:id/dokumentasi-tambahan   status jalur + foto per kategori (UNIT_READ)
//   POST /units/:id/dokumentasi-tambahan   multipart: category + files[] (≤ 6 foto JPG/PNG/WEBP, ≤ 15 MB) — PRODUCTION_DOCUMENTATION_WRITE
// Hanya untuk unit yang TIDAK bisa memakai Dokumentasi V2 (lihat services/unitDocumentationService.js). Informasi saja.
const unggahDok = multer({
  storage: multer.diskStorage({ destination: os.tmpdir(), filename: (_req, _file, cb) => cb(null, `dok-${crypto.randomUUID()}.part`) }),
  limits: { fileSize: DOK_TAMBAHAN_MAKS_BYTES, files: DOK_TAMBAHAN_MAKS_FOTO },
  fileFilter: (_req, file, cb) => cb(null, ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)),
});
const bersihkan = (req) => { for (const f of req.files || []) { try { if (f.path && fs.existsSync(f.path)) fs.unlinkSync(f.path); } catch { /* abaikan */ } } };

productionWorkspaceRouter.get("/units/:id/dokumentasi-tambahan", requirePermission(P.UNIT_READ), wajibUuid(), async (req, res) => {
  try {
    const st = await statusDokumentasiTambahan(prisma, req.params.id, { izinTulis: hasPermission(req.user, P.PRODUCTION_DOCUMENTATION_WRITE) });
    if (!st) return res.status(404).json({ error: "Unit tidak ditemukan", code: "UNIT_TIDAK_ADA" });
    res.set("Cache-Control", "no-store");
    res.json({ ...st, ...(await daftarDokumentasiTambahan(prisma, req.params.id)) });
  } catch (err) { handleErr(err, res); }
});

productionWorkspaceRouter.post("/units/:id/dokumentasi-tambahan", requirePermission(P.PRODUCTION_DOCUMENTATION_WRITE), wajibUuid(), (req, res, next) => {
  unggahDok.array("files", DOK_TAMBAHAN_MAKS_FOTO)(req, res, (err) => {
    if (err?.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "Foto terlalu besar (maksimal 15 MB)", code: "DOK_TERLALU_BESAR" });
    if (err?.code === "LIMIT_FILE_COUNT") return res.status(400).json({ error: `Maksimal ${DOK_TAMBAHAN_MAKS_FOTO} foto sekali unggah`, code: "DOK_TERLALU_BANYAK" });
    if (err) return next(err);
    return next();
  });
}, async (req, res) => {
  try {
    const hasil = await catatDokumentasiTambahan(prisma, { unitId: req.params.id, category: String(req.body?.category || ""), files: req.files || [], actorId: req.user.id, izinTulis: true });
    res.status(201).json({ ...hasil, ...(await daftarDokumentasiTambahan(prisma, req.params.id)) });
  } catch (err) { handleErr(err, res); } finally { bersihkan(req); }
});
