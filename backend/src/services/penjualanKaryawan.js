// PENJUALAN KARYAWAN (1 Okt 2026) — order yang dijual karyawan NON-Sales (mis. karyawan produksi/driver menjual kasur Sano ke kerabat).
//
// Skema: SATU penanda di tingkat ORDER, Order.staffSellerId (User, boleh kosong). Terisi = "Penjualan Karyawan". Sengaja di order, bukan di pelanggan: kerabat yang membeli bisa banyak
// dan berbeda, sedangkan yang perlu dilacak adalah karyawan penjualnya (yang menanggung tagihan bila belum dibayar).
//
// Perlakuan laporan (keputusan Owner): order TETAP masuk omzet/total perusahaan, tetapi TERPISAH dari angka Tim Sales (tidak masuk performa/target/ranking sales).
// Itu otomatis: penjualnya bukan role SALES sehingga order ini tidak pernah punya pemilik Sales (salesOwnerId kosong) — lihat services/salesOwner.js & rekonSalesFinance.js.
//
// TIDAK PERNAH menulis Payment/jurnal/saldo. "Terbayar" selalu dibaca dari ledger (paidForOrder), "tagihan" dari dasarStatusBayar — sama dengan Klaim Lunas.
// Pemotongan gaji/kasbon BUKAN pembayaran pelanggan: dicatat Finance lewat modul Kasbon (pelunasan "Potong Gaji"), tidak di sini.
import { paidForOrder } from "./finance/allocation.js";
import { getVerificationGate } from "./finance/settings.js";
import { dasarStatusBayar, PILIH_TAGIHAN } from "./finance/tagihanOrder.js";
import { moneyToNumber } from "./finance/money.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";
import { rolesOf } from "../middleware/authorize.js";
import { startOfDayWIB, endOfDayExclusiveWIB } from "../utils/wib.js";

export class PenjualanKaryawanError extends Error {
  constructor(message, statusCode = 400, code = "PENJUALAN_KARYAWAN") { super(message); this.statusCode = statusCode; this.code = code; }
}

const rp = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Karyawan penjual harus akun aktif dan BUKAN Sales (penjualan tim Sales punya jalur sendiri). Dipakai penanda di Order dan modul Penjualan Karyawan manual. */
export async function pastikanKaryawanNonSales(db, userId) {
  const u = await db.user.findUnique({ where: { id: userId }, select: { id: true, name: true, active: true, role: true, roles: { select: { role: true } } } });
  if (!u || !u.active) throw new PenjualanKaryawanError("Karyawan tidak ditemukan atau tidak aktif", 422, "KARYAWAN_TIDAK_VALID");
  if (rolesOf({ role: u.role, roles: u.roles.map((r) => r.role) }).includes("SALES")) throw new PenjualanKaryawanError("Penjual karyawan harus non-Sales. Order yang dijual tim Sales ditetapkan lewat pemilik Sales.", 422, "KARYAWAN_ADALAH_SALES");
  return u;
}

/** Set / hapus penjual karyawan sebuah order (Admin). `staffSellerId = null` menghapus penanda. Diaudit. `tx` = klien transaksi. */
export async function ubahPenjualKaryawan(tx, { orderId, staffSellerId = null, actorId }) {
  const order = await tx.order.findUnique({ where: { id: orderId }, select: { id: true, orderNumber: true, staffSellerId: true, staffSeller: { select: { name: true } } } });
  if (!order) throw new PenjualanKaryawanError("Order tidak ditemukan", 404, "ORDER_TIDAK_ADA");
  const baru = staffSellerId || null;
  if ((order.staffSellerId ?? null) === baru) throw new PenjualanKaryawanError("Penjual karyawan sudah sama", 409, "SUDAH_SAMA");
  let namaBaru = null;
  if (baru) {
    namaBaru = (await pastikanKaryawanNonSales(tx, baru)).name;
  }
  await tx.order.update({ where: { id: orderId }, data: { staffSellerId: baru } });
  await recordActivity(tx, {
    entityType: ENTITY_TYPES.ORDER, entityId: orderId, eventType: EVENT_TYPES.PENJUALAN_KARYAWAN_DIUBAH, actorId,
    metadata: { orderNumber: order.orderNumber, before: order.staffSeller?.name ?? null, to: namaBaru },
  });
  return { orderId, orderNumber: order.orderNumber, staffSellerId: baru, nama: namaBaru };
}

/**
 * Ringkasan Penjualan Karyawan per karyawan (order non-batal; periode = tanggal order dibuat, WIB; tanpa periode = semua).
 * tagihan − terbayar = sisa tagihan karyawan (terbayar dibaca dari ledger/Payment terverifikasi; potong gaji dicatat Finance di modul Kasbon).
 */
export async function ringkasanPenjualanKaryawan(db, { from = null, to = null } = {}) {
  const gate = await getVerificationGate(db);
  const orders = await db.order.findMany({
    where: {
      staffSellerId: { not: null }, status: { not: "CANCELLED" },
      ...(from && to ? { createdAt: { gte: startOfDayWIB(from), lt: endOfDayExclusiveWIB(to) } } : {}),
    },
    select: { ...PILIH_TAGIHAN, orderNumber: true, createdAt: true, paymentStatus: true, staffSellerId: true, staffSeller: { select: { id: true, name: true } }, customer: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  const per = new Map();
  for (const o of orders) {
    const tagihan = dasarStatusBayar(o);
    const terbayar = moneyToNumber(await paidForOrder(db, o.id, gate));
    const sisa = Math.max(tagihan - terbayar, 0);
    const k = per.get(o.staffSellerId) ?? { staffSellerId: o.staffSellerId, nama: o.staffSeller.name, jumlahOrder: 0, nilai: 0, terbayar: 0, sisa: 0, orders: [] };
    k.jumlahOrder += 1; k.nilai += tagihan; k.terbayar += Math.min(terbayar, tagihan); k.sisa += sisa;
    k.orders.push({ id: o.id, orderNumber: o.orderNumber, tanggal: o.createdAt, pelanggan: o.customer.name, nilai: rp(tagihan), terbayar: rp(terbayar), sisa: rp(sisa), paymentStatus: o.paymentStatus });
    per.set(o.staffSellerId, k);
  }
  const karyawan = [...per.values()].map((k) => ({ ...k, nilai: rp(k.nilai), terbayar: rp(k.terbayar), sisa: rp(k.sisa) })).sort((a, b) => b.sisa - a.sisa || b.nilai - a.nilai);
  const jumlah = (f) => rp(karyawan.reduce((s, k) => s + k[f], 0));
  return {
    periode: from && to ? { from, to } : null,
    total: { jumlahOrder: karyawan.reduce((s, k) => s + k.jumlahOrder, 0), nilai: jumlah("nilai"), terbayar: jumlah("terbayar"), sisa: jumlah("sisa") },
    karyawan,
    catatan: [
      "Penjualan Karyawan masuk total order dan omzet perusahaan, tetapi tidak masuk angka Tim Sales (performa, target, ranking).",
      "Terbayar dibaca dari pembayaran terverifikasi. Pemotongan gaji/kasbon dicatat Finance di modul Kasbon dan tidak otomatis mengurangi sisa tagihan di sini.",
    ],
  };
}
