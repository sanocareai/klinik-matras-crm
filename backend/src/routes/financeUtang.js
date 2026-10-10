// JADWAL & AGING UTANG SUPPLIER — di-mount di /api/finance. Semua angka dari satu read-model (services/finance/agingUtang.js), sama dengan export.
//   GET  /utang/aging                  finance:read   kartu ringkasan + kelompok + baris (filter: supplierId, kelompok, q, fakturDari/Sampai, jatuhTempoDari/Sampai, termasukLunas)
//   GET  /utang/aging/:billId          finance:read   detail satu faktur (riwayat pembayaran, termin, jadwal)
//   POST /utang/termin/pratinjau       finance:read   termin default + jatuh tempo untuk formulir (klien tidak menghitung sendiri)
//   PUT  /bills/:id/jadwal-bayar       finance:post   buat/ubah/hapus DRAF jadwal bayar (rencana saja — tidak membayar, tidak menjurnal)
// Gudang/Produksi tidak punya izin finance:read → tidak bisa membaca nominal utang, rekening, atau jadwal.
import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { idempotency } from "../middleware/idempotency.js";
import { requirePermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { prisma } from "../db.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";
import { handleFinanceError } from "./finance.js";
import { lockRowForUpdate } from "../services/inventoryLedger.js";
import { toBookDate, todayBookDateWIB } from "../services/finance/journal.js";
import { bacaAgingUtang, bacaDetailUtang, STATUS_FAKTUR_AGING } from "../services/finance/agingUtang.js";
import { pratinjauTermin } from "../services/finance/termin.js";

export const financeUtangRouter = express.Router();
financeUtangRouter.use(requireAuth);
financeUtangRouter.use(idempotency);

const POLA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const galat = (message, statusCode = 400, code) => Object.assign(new Error(message), { statusCode, ...(code && { code }) });

/** Query layar → filter read-model. Dipakai juga oleh export supaya filter identik. */
export function filterDariQuery(q = {}) {
  const s = (v) => (v === undefined || v === null || v === "" ? undefined : String(v).slice(0, 120));
  return {
    supplierId: s(q.supplierId) && POLA_UUID.test(s(q.supplierId)) ? s(q.supplierId) : undefined, kelompok: s(q.kelompok), q: s(q.q),
    fakturDari: s(q.fakturDari), fakturSampai: s(q.fakturSampai), jatuhTempoDari: s(q.jatuhTempoDari), jatuhTempoSampai: s(q.jatuhTempoSampai),
    termasukLunas: q.termasukLunas === "1" || q.termasukLunas === true,
  };
}

financeUtangRouter.get("/utang/aging", requirePermission(P.FINANCE_READ), async (req, res) => {
  try { res.json(await bacaAgingUtang(prisma, filterDariQuery(req.query))); } catch (e) { handleFinanceError(e, res); }
});

financeUtangRouter.get("/utang/aging/:billId", requirePermission(P.FINANCE_READ), async (req, res) => {
  try {
    if (!POLA_UUID.test(req.params.billId)) return res.status(404).json({ error: "Faktur tidak ditemukan" });
    const hasil = await bacaDetailUtang(prisma, req.params.billId);
    if (!hasil) return res.status(404).json({ error: "Faktur tidak ditemukan atau belum disetujui" });
    res.json(hasil);
  } catch (e) { handleFinanceError(e, res); }
});

financeUtangRouter.post("/utang/termin/pratinjau", requirePermission(P.FINANCE_READ), async (req, res) => {
  try {
    const { supplierId, purchaseOrderId, billDate, dasar } = req.body ?? {};
    if (!supplierId || !POLA_UUID.test(String(supplierId))) throw galat("Supplier wajib dipilih");
    const supplier = await prisma.finSupplier.findUnique({ where: { id: supplierId }, select: { paymentTermDays: true, paymentTermType: true } });
    if (!supplier) throw galat("Supplier tidak ditemukan", 404);
    const po = purchaseOrderId && POLA_UUID.test(String(purchaseOrderId))
      ? await prisma.finPurchaseOrder.findUnique({ where: { id: purchaseOrderId }, select: { termType: true, termDays: true, supplierId: true } }) : null;
    if (po && po.supplierId !== supplierId) throw galat("PO bukan milik supplier ini", 400);
    res.json(pratinjauTermin({ supplier, po, tanggalFaktur: billDate ? toBookDate(billDate) : todayBookDateWIB(), dasar: dasar === "TANGGAL_TIBA" || po ? "TANGGAL_TIBA" : undefined }));
  } catch (e) { handleFinanceError(e, res); }
});

// Draf jadwal bayar: rencana tanggal + rekening untuk faktur yang SUDAH disetujui dan masih ada sisa. Tidak membuat pembayaran/jurnal; pembayaran tetap lewat Pembayaran Supplier.
financeUtangRouter.put("/bills/:id/jadwal-bayar", requirePermission(P.FINANCE_POST), async (req, res) => {
  try {
    if (!POLA_UUID.test(req.params.id)) throw galat("Faktur tidak ditemukan", 404);
    const b = req.body ?? {};
    const hapus = b.date === null || b.date === "" || b.hapus === true;
    const hasil = await prisma.$transaction(async (tx) => {
      await lockRowForUpdate(tx, '"fin_supplier_bills"', req.params.id);
      const bill = await tx.finSupplierBill.findUnique({
        where: { id: req.params.id },
        select: { id: true, billNumber: true, status: true, amount: true, creditApplied: true, scheduledPayDate: true, allocations: { where: { payment: { cancelledAt: null } }, select: { amount: true } } },
      });
      if (!bill) throw galat("Faktur tidak ditemukan", 404);
      if (!STATUS_FAKTUR_AGING.includes(bill.status) || bill.status === "LUNAS") throw galat(`Faktur berstatus ${bill.status} — jadwal bayar hanya untuk faktur yang sudah disetujui dan belum lunas`, 409);
      let data;
      if (hapus) data = { scheduledPayDate: null, scheduledCashAccountId: null, scheduledNote: null, scheduledById: req.user.id, scheduledAt: new Date() };
      else {
        if (!b.cashAccountId || !POLA_UUID.test(String(b.cashAccountId))) throw galat("Rekening pembayaran wajib dipilih");
        const rek = await tx.finCashAccount.findUnique({ where: { id: b.cashAccountId }, select: { id: true, active: true, name: true } });
        if (!rek || rek.active === false) throw galat("Rekening tidak ditemukan atau nonaktif", 404);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.date))) throw galat("Tanggal rencana bayar tidak valid (YYYY-MM-DD)");
        data = { scheduledPayDate: toBookDate(b.date), scheduledCashAccountId: rek.id, scheduledNote: String(b.note ?? "").trim().slice(0, 300) || null, scheduledById: req.user.id, scheduledAt: new Date() };
      }
      await tx.finSupplierBill.update({ where: { id: bill.id }, data });
      await recordActivity(tx, {
        entityType: ENTITY_TYPES.FIN_SUPPLIER_BILL, entityId: bill.id, eventType: EVENT_TYPES.DOCUMENT_EDITED, actorId: req.user.id,
        metadata: { aksi: hapus ? "hapus_jadwal_bayar" : "atur_jadwal_bayar", billNumber: bill.billNumber, sebelum: bill.scheduledPayDate ? bill.scheduledPayDate.toISOString().slice(0, 10) : null, sesudah: hapus ? null : String(b.date) },
      });
      return bill.id;
    });
    res.json(await bacaDetailUtang(prisma, hasil));
  } catch (e) { handleFinanceError(e, res); }
});
