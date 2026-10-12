// TANGGAL LUNAS BERBEDA DARI TANGGAL PEMBAYARAN YANG MELUNASI — read-model server untuk tab "Perlu Tindakan" layar Piutang (Okt 2026). Hanya MEMBACA.
//
// Tidak ada aturan baru: dua fungsi murni yang sudah dipakai kohort atribusi dipakai ulang —
//   jejakPembayaran()        : hari WIB pembayaran yang membuat total yang dihitung mencapai tagihan (urut hari WIB lalu id; sama dengan tanggalLunasEfektif),
//   tanggalLunasMenurutCrm() : hari WIB Order.paidAt (null bila bukan LUNAS / tanpa tanggal / timestamp backfill 31 Agt 2026).
// Order masuk daftar bila: tersimpan LUNAS, paidAt TERCATAT (bukan backfill), ledger valid benar-benar melunasi, dan kedua hari WIB berbeda.
// Order yang tanggalnya DIKUNCI pengecualian Owner (OrderPaidAtPengecualian aktif) TIDAK dimasukkan — itu keputusan sadar — tetapi jumlahnya dilaporkan.
// TIDAK PERNAH mengubah Order.paidAt atau Payment.
import { endOfDayExclusiveWIB } from "../../utils/wib.js";
import { kontribusiPembayaranOrders, isPaymentCounted } from "./allocation.js";
import { PILIH_TAGIHAN, dasarStatusBayar } from "./tagihanOrder.js";
import { getVerificationGate } from "./settings.js";
import { jejakPembayaran, tanggalLunasMenurutCrm } from "../attribution/cohort.js";

const CHUNK = 2000;
const potong = (arr, n = CHUNK) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };
const hariAntara = (a, b) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

/**
 * @param {object} db  Prisma (dibaca saja)
 * @param {{ to: Date|string }} opsi  posisi (hari WIB, inklusif). Order yang paidAt-nya sesudah posisi tidak dihitung.
 * @returns {{ baris: object[], dikecualikanOwner: number, diperiksa: number }}
 */
export async function orderTanggalLunasBeda(db, { to }) {
  const hariPosisi = (to instanceof Date ? to.toISOString() : String(to)).slice(0, 10);
  const orders = await db.order.findMany({
    where: { paymentStatus: "LUNAS", status: { not: "CANCELLED" }, penjualanKaryawanId: null, paidAt: { not: null, lt: endOfDayExclusiveWIB(hariPosisi) } },
    select: { ...PILIH_TAGIHAN, orderNumber: true, paymentStatus: true, paidAt: true, customer: { select: { name: true, assignedSales: { select: { name: true } } } } },
  });
  if (orders.length === 0) return { baris: [], dikecualikanOwner: 0, diperiksa: 0 };
  const ids = orders.map((o) => o.id);

  const dikunci = new Set();
  const gate = await getVerificationGate(db);
  const kontribusi = new Map();
  const refunds = new Map();
  for (const part of potong(ids)) {
    for (const r of await db.orderPaidAtPengecualian.findMany({ where: { orderId: { in: part }, dicabutAt: null }, select: { orderId: true } })) dikunci.add(r.orderId);
    const peta = await kontribusiPembayaranOrders(db, part, { select: { verifications: { select: { id: true } } } });
    for (const [orderId, daftar] of peta) {
      const ok = daftar
        .filter((k) => isPaymentCounted({ createdAt: k.createdAt, cancelledAt: null, verifications: k.verifications }, gate))
        .map((k) => ({ id: `${k.id}:${orderId}`, amount: k.amount, createdAt: k.createdAt }));
      kontribusi.set(orderId, ok);
    }
    for (const r of await db.finRefund.findMany({ where: { orderId: { in: part }, status: "DISETUJUI" }, select: { orderId: true, amount: true } })) {
      (refunds.get(r.orderId) || refunds.set(r.orderId, []).get(r.orderId)).push({ amount: Number(r.amount) });
    }
  }

  const baris = [];
  let dikecualikanOwner = 0;
  for (const o of orders) {
    const tagihan = dasarStatusBayar(o);
    const jejak = jejakPembayaran(kontribusi.get(o.id) || [], tagihan, refunds.get(o.id) || []);
    const crm = tanggalLunasMenurutCrm({ ...o, paidAtDikunciOwner: dikunci.has(o.id) }, jejak);
    if (!crm || crm.sumber !== "TERCATAT" || jejak.status !== "LUNAS" || !jejak.hariLunas) continue;
    if (crm.hari === jejak.hariLunas) continue;
    if (crm.dikunciOwner) { dikecualikanOwner += 1; continue; }
    baris.push({
      orderId: o.id, orderNumber: o.orderNumber ?? null, customerName: o.customer?.name ?? "—", salesName: o.customer?.assignedSales?.name ?? null,
      tanggalLunasCrm: crm.hari, tanggalPembayaranMelunasi: jejak.hariLunas, selisihHari: hariAntara(crm.hari, jejak.hariLunas), nilai: tagihan,
    });
  }
  baris.sort((a, b) => Math.abs(b.selisihHari) - Math.abs(a.selisihHari));
  return { baris, dikecualikanOwner, diperiksa: orders.length };
}
