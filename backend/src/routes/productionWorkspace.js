// RUANG KERJA STATUS PRODUKSI — endpoint baca untuk Daftar Kerja (per order) dan header Ruang Kerja Unit. Dipasang di /api/production.
//   GET /work-list                  daftar order (aktif/riwayat) + unit di dalamnya, pencarian/filter/urutan/halaman di server
//   GET /units/:id/ruang-kerja      fakta header unit: order Sales, alur Meja (bila ada), ketersediaan Dokumentasi + alasan jujur bila tidak tersedia
// Isi lengkap (status kerja, rencana bahan, pemakaian aktual, riwayat) tetap dari GET /units/:id/adopsi; dokumentasi dari /api/production-v2/documentation/*. Tidak ada jalur tulis baru di sini.
import express from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission, hasPermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { wajibUuid } from "../lib/uuidParam.js";
import { pesanServerAman } from "../lib/galatServerAman.js";
import { PHASE_LABEL, RUN_STATUS_LABEL, listWorkList } from "../services/productionWorkListService.js";
import { UNIT_INCLUDE, perkayaBarisUnit } from "../services/productionOrderList.js";
import { perhatianUnit, tindakanTersedia } from "../lib/domain/productionWorkList.js";
import { displayStatusOfOrder, displayStatusOfUnit } from "../lib/domain/productionDisplay.js";
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
        order: { select: { id: true, orderNumber: true, status: true, statusLocked: true, customer: { select: { id: true, name: true } }, items: { select: { layananName: true }, orderBy: { sortOrder: "asc" } }, units: { select: { id: true, unitCode: true, status: true }, orderBy: { seq: "asc" } } } },
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
      },
      alurMeja, tindakan, perhatian,
      dokumentasi,
      izin: { unggahDokumentasi: izinTulis, ubahStatusOrder: hasPermission(req.user, P.ORDER_WRITE), unggahFotoIdentitas: hasPermission(req.user, P.UNIT_ROUTING_WRITE) },
    });
  } catch (err) { handleErr(err, res); }
});
