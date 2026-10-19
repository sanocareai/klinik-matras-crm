// ADOPSI ADMIN → PIC BAHAN → APLIKASI MESA: endpoint Order Produksi tambahan (dipasang di /api/production).
//   GET  /units/:id/adopsi            panel unit: ringkasan 3 sumbu status, status kerja manual + riwayat, rencana bahan, pemakaian aktual, riwayat perubahan
//   POST /units/:id/work-progress     catat status kerja manual (UNIT_ROUTING_WRITE); ditolak bila bukti aplikasi ada
//   GET  /material-catalog            katalog bahan per kelompok Gudang + ketersediaan jujur (UNIT_READ)
//   GET  /units/:id/material-plan     rencana bahan + revisi
//   PUT  /units/:id/material-plan     simpan/revisi rencana (UNIT_ROUTING_WRITE) — TIDAK mengurangi stok
//   GET  /work-orders/export.xlsx     ekspor Excel (.xlsx sungguhan) dengan filter yang sama dengan daftar
// Perubahan status ORDER dari Produksi memakai endpoint Sales yang SAMA (PATCH /api/orders/:id, fungsi domain ubahStatusUnitInTx) — tidak ada jalur status kedua.
import express from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission, hasPermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { wajibUuid } from "../lib/uuidParam.js";
import { pesanServerAman } from "../lib/galatServerAman.js";
import { listWorkOrders, perkayaBarisUnit } from "../services/productionOrderList.js";
import { AdopsiError, ambilPemakaianAktual, ambilRencanaBahan, catatStatusKerjaManual, katalogBahan, loadAppEvidence, riwayatKerjaUnit, simpanRencanaBahan } from "../services/productionAdoptionService.js";
import { RencanaBahanError } from "../lib/domain/productionMaterialPlan.js";
import { loadRiwayatUnit } from "../services/productionRiwayatService.js";
import { buatWorkbookOrderProduksi, namaBerkasEkspor } from "../services/productionOrderExport.js";
import { MANUAL_STATUSES, WORK_STATUS } from "../lib/domain/productionWorkStatus.js";

export const productionAdopsiRouter = express.Router();
productionAdopsiRouter.use(requireAuth);

function handleErr(err, res) {
  if (err instanceof AdopsiError || err instanceof RencanaBahanError || (Number.isInteger(err?.statusCode) && err.code)) {
    return res.status(err.statusCode).json({ error: err.message, code: err.code, ...(err.extra ? { detail: err.extra } : {}) });
  }
  console.error("Produksi adopsi error:", err);
  return res.status(500).json({ error: pesanServerAman(err) });
}

const bolehUbah = (user) => ({
  statusOrder: hasPermission(user, P.ORDER_WRITE), // jalur Sales yang sama
  statusKerja: hasPermission(user, P.UNIT_ROUTING_WRITE),
  target: hasPermission(user, P.UNIT_ROUTING_WRITE),
  rencanaBahan: hasPermission(user, P.UNIT_ROUTING_WRITE),
  pemakaianAktual: hasPermission(user, P.UNIT_MATERIAL_WRITE),
});

productionAdopsiRouter.get("/units/:id/adopsi", requirePermission(P.UNIT_READ), wajibUuid(), async (req, res) => {
  try {
    const unit = await prisma.unit.findUnique({
      where: { id: req.params.id },
      include: {
        currentStage: { select: { id: true, code: true, labelId: true, phase: true, requiresQc: true, defaultWorkCenter: { select: { id: true, code: true, name: true } } } },
        service: { select: { id: true, code: true, labelId: true, serviceLine: true } },
        order: { select: { id: true, orderNumber: true, status: true, deliveryConfirmedDate: true, statusLocked: true, items: { select: { layananName: true }, orderBy: { sortOrder: "asc" } }, customer: { select: { id: true, name: true } }, units: { select: { id: true, unitCode: true, status: true } } } },
      },
    });
    if (!unit) return res.status(404).json({ error: "Unit tidak ditemukan", code: "UNIT_TIDAK_ADA" });
    const [baris] = await perkayaBarisUnit(prisma, [unit]);
    const bukti = (await loadAppEvidence(prisma, [unit.id])).get(unit.id);
    const [riwayatKerja, rencana, aktual, run] = await Promise.all([
      riwayatKerjaUnit(prisma, unit.id, bukti?.firstEvidenceAt ?? null), ambilRencanaBahan(prisma, unit.id), ambilPemakaianAktual(prisma, unit.id),
      prisma.productionRun.findFirst({ where: { unitId: unit.id }, orderBy: { createdAt: "desc" }, select: { id: true } }),
    ]);
    const riwayat = (await loadRiwayatUnit(prisma, { unit: { id: unit.id, orderId: unit.orderId }, run })).slice(-60).reverse();
    // perbandingan rencana vs aktual per bahan (hanya bahan yang ada di salah satunya)
    const rencanaMap = new Map((rencana.plan?.lines ?? []).map((l) => [l.materialId, l]));
    const aktualMap = new Map(aktual.total.map((t) => [t.materialId, t]));
    const ids = [...new Set([...rencanaMap.keys(), ...aktualMap.keys()])];
    const perbandingan = ids.map((id) => { const r = rencanaMap.get(id); const a = aktualMap.get(id); return { materialId: id, kode: r?.kode ?? a?.kode, nama: r?.nama ?? a?.nama, satuan: r?.satuan ?? a?.satuan, rencana: r ? r.qty : null, aktual: a ? a.dipakai : 0 }; });
    res.json({
      unit: {
        id: unit.id, unitCode: unit.unitCode, status: unit.status, merk: unit.merk, ukuran: unit.ukuran, priority: unit.priority, productionDueAt: unit.productionDueAt, updatedAt: unit.updatedAt,
        layanan: (unit.order?.items || []).map((i) => i.layananName).filter(Boolean),
        order: { id: unit.order.id, orderNumber: unit.order.orderNumber, status: unit.order.status, deliveryConfirmedDate: unit.order.deliveryConfirmedDate, statusLocked: unit.order.statusLocked, customer: unit.order.customer, jumlahUnit: unit.order.units.length, unitLain: unit.order.units.filter((u) => u.id !== unit.id).map((u) => ({ id: u.id, unitCode: u.unitCode, status: u.status })) },
      },
      adopsi: baris.adopsi, productionStatus: baris.productionStatus, presence: baris.presence, receivedBasisLabel: baris.receivedBasisLabel,
      kerjaManual: { riwayat: riwayatKerja, nilaiBoleh: MANUAL_STATUSES.map((k) => ({ key: k, label: WORK_STATUS[k].label })), terakhirId: riwayatKerja.length ? riwayatKerja[riwayatKerja.length - 1].id : null, dikunciAplikasi: !!bukti?.started },
      rencanaBahan: rencana, pemakaianAktual: aktual, perbandingan, riwayat,
      izin: bolehUbah(req.user),
    });
  } catch (err) { handleErr(err, res); }
});

productionAdopsiRouter.post("/units/:id/work-progress", requirePermission(P.UNIT_ROUTING_WRITE), wajibUuid(), async (req, res) => {
  try {
    const hasil = await catatStatusKerjaManual(prisma, { unitId: req.params.id, status: req.body?.status, note: req.body?.note, actorId: req.user.id, expectedLatestId: req.body?.expectedLatestId });
    res.status(hasil.dicatat ? 201 : 200).json({ dicatat: hasil.dicatat, entri: hasil.entri ? { id: hasil.entri.id, status: hasil.entri.status, note: hasil.entri.note, createdAt: hasil.entri.createdAt } : null });
  } catch (err) { handleErr(err, res); }
});

productionAdopsiRouter.get("/material-catalog", requirePermission(P.UNIT_READ), async (req, res) => {
  try { res.json(await katalogBahan(prisma, { q: req.query.q, kelompok: req.query.kelompok || null, limit: req.query.limit })); } catch (err) { handleErr(err, res); }
});

productionAdopsiRouter.get("/units/:id/material-plan", requirePermission(P.UNIT_READ), wajibUuid(), async (req, res) => {
  try { res.json(await ambilRencanaBahan(prisma, req.params.id)); } catch (err) { handleErr(err, res); }
});

productionAdopsiRouter.put("/units/:id/material-plan", requirePermission(P.UNIT_ROUTING_WRITE), wajibUuid(), async (req, res) => {
  try {
    const hasil = await simpanRencanaBahan(prisma, { unitId: req.params.id, lines: req.body?.lines, expectedRevision: req.body?.expectedRevision ?? 0, reason: req.body?.reason, actorId: req.user.id });
    res.status(hasil.disimpan ? 200 : 200).json({ ...hasil, rencana: await ambilRencanaBahan(prisma, req.params.id) });
  } catch (err) { handleErr(err, res); }
});

productionAdopsiRouter.get("/work-orders/export.xlsx", requirePermission(P.UNIT_READ), async (req, res) => {
  try {
    const hasil = await listWorkOrders(prisma, req.query, { semua: true });
    const unitIds = hasil.units.map((u) => u.id);
    const buffer = await buatWorkbookOrderProduksi(prisma, { rows: hasil.units, unitIds, filter: hasil.filterDipakai, pengguna: req.user?.name ?? null });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${namaBerkasEkspor()}"`);
    res.setHeader("Cache-Control", "no-store");
    res.end(Buffer.from(buffer));
  } catch (err) { handleErr(err, res); }
});
