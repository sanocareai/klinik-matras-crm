// FASE 1 — LOADER KOHORT (BACA-SAJA). Hanya findMany/queryRaw SELECT; tidak ada create/update/delete, tidak ada transaksi tulis.
// Memakai aturan yang SUDAH ada supaya kohort tidak menciptakan definisi uang kedua:
//   - kontribusi pembayaran sadar-alokasi   : services/finance/allocation.js#kontribusiPembayaranOrders
//   - pembayaran yang dihitung              : isPaymentCounted(gate)  (dibatalkan/ belum diverifikasi saat gerbang aktif → tidak dihitung)
//   - tagihan kanonis (value + ongkir)      : services/finance/tagihanOrder.js (PILIH_TAGIHAN, dasarStatusBayar)
//   - refund yang mengurangi uang           : FinRefund status DISETUJUI
//
// Tidak memuat isi chat, nama, nomor telepon, atau data kesehatan: kolom yang dipilih hanya yang tertulis di bawah.
import { startOfDayWIB, endOfDayExclusiveWIB } from "../../utils/wib.js";
import { kontribusiPembayaranOrders, isPaymentCounted } from "../finance/allocation.js";
import { PILIH_TAGIHAN, dasarStatusBayar } from "../finance/tagihanOrder.js";
import { nilaiBersih } from "../orderNilaiBersih.js";
import { getVerificationGate } from "../finance/settings.js";
import { STAGE_PROSPEK_ATAU_LANJUT } from "./cohortDefinitions.js";
import { buildCohort } from "./cohort.js";

const UKURAN_CHUNK = 5000;
const potong = (arr, n = UKURAN_CHUNK) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };

/**
 * @param {object} db  PrismaClient (hanya dibaca)
 * @param {{leadFrom?: string, leadTo?: string}} [rentang]  YYYY-MM-DD (hari WIB, inklusif). Kosong = semua customer.
 */
export async function muatMasukanKohort(db, { leadFrom, leadTo } = {}) {
  const whereCust = {};
  if (leadFrom || leadTo) {
    whereCust.createdAt = {};
    if (leadFrom) whereCust.createdAt.gte = startOfDayWIB(leadFrom);
    if (leadTo) whereCust.createdAt.lt = endOfDayExclusiveWIB(leadTo);
  }
  const customers = await db.customer.findMany({
    where: whereCust,
    select: { id: true, createdAt: true, pipelineStage: true, leadSource: true, isInternalStaff: true, staffUserId: true },
  });
  const ids = customers.map((c) => c.id);

  const transisi = [];
  for (const part of potong(ids)) {
    transisi.push(...await db.pipelineTransition.findMany({
      where: { customerId: { in: part }, toStage: { in: STAGE_PROSPEK_ATAU_LANJUT } },
      select: { customerId: true, toStage: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }));
  }
  const perCust = new Map();
  for (const t of transisi) (perCust.get(t.customerId) || perCust.set(t.customerId, []).get(t.customerId)).push({ toStage: t.toStage, createdAt: t.createdAt });
  for (const c of customers) c.transitions = perCust.get(c.id) || [];

  const ordersRaw = [];
  for (const part of potong(ids)) {
    ordersRaw.push(...await db.order.findMany({
      where: { customerId: { in: part } },
      select: { ...PILIH_TAGIHAN, customerId: true, createdAt: true, paymentStatus: true, paidAt: true, penjualanKaryawanId: true },
    }));
  }
  const orders = ordersRaw.map((o) => ({
    id: o.id, customerId: o.customerId, createdAt: o.createdAt, status: o.status, value: nilaiBersih(o), // BERSIH dari Nota Kredit aktif (Okt 2026)
    tagihan: dasarStatusBayar(o), paymentStatus: o.paymentStatus, paidAt: o.paidAt, penjualanKaryawanId: o.penjualanKaryawanId,
  }));
  const orderIds = orders.map((o) => o.id);

  // Pengecualian tanggal lunas Owner yang masih aktif: membuktikan TANGGAL yang dikunci, bukan uang diterima.
  const dikunci = new Set();
  for (const part of potong(orderIds)) {
    const rows = await db.orderPaidAtPengecualian.findMany({ where: { orderId: { in: part }, dicabutAt: null }, select: { orderId: true } });
    for (const r of rows) dikunci.add(r.orderId);
  }
  for (const o of orders) o.paidAtDikunciOwner = dikunci.has(o.id);

  const gate = await getVerificationGate(db);
  const kontribusi = [];
  const refunds = [];
  for (const part of potong(orderIds)) {
    const peta = await kontribusiPembayaranOrders(db, part, { select: { verifications: { select: { id: true } } } });
    for (const [orderId, daftar] of peta) {
      for (const k of daftar) {
        // `k.id` = id Payment; satu Payment boleh berkontribusi ke beberapa order (alokasi) → kunci gabungan.
        if (!isPaymentCounted({ createdAt: k.createdAt, cancelledAt: null, verifications: k.verifications }, gate)) continue;
        kontribusi.push({ id: `${k.id}:${orderId}`, orderId, amount: k.amount, createdAt: k.createdAt });
      }
    }
    refunds.push(...await db.finRefund.findMany({
      where: { orderId: { in: part }, status: "DISETUJUI" },
      select: { orderId: true, amount: true, approvedAt: true, date: true, status: true },
    }));
  }
  const refundBersih = refunds.map((r) => ({ ...r, amount: Number(r.amount) }));

  return {
    customers, orders, kontribusi, refunds: refundBersih,
    meta: { leadFrom: leadFrom || null, leadTo: leadTo || null, gate: { enabled: gate.enabled, since: gate.since }, jumlah: { customers: customers.length, orders: orders.length, kontribusi: kontribusi.length, refunds: refundBersih.length } },
  };
}

/** Muat + hitung. Mengembalikan agregat saja (tanpa ID customer/order/pembayaran). */
export async function hitungKohort(db, rentang = {}) {
  const { meta, ...masukan } = await muatMasukanKohort(db, rentang);
  return { meta, ...buildCohort(masukan) };
}
