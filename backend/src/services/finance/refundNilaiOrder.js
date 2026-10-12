// REFUND PEMBATALAN SEBAGIAN — mengurangi NILAI ORDER otomatis (keputusan Owner 12 Okt 2026).
//
// Masalah nyata (RES-07102026-037): pelanggan sudah bayar Lunas Rp4.300.000, sebagian pesanan (triplek) tidak jadi → refund Rp200.000. Refund mengurangi "uang yang
// dipegang" (Rp4,1 jt) tetapi nilai order tetap Rp4,3 jt, jadi status bayar turun otomatis ke DP dan Sales harus mengedit nilai order manual supaya kembali Lunas.
//
// Skema khusus: refund bertanda `kurangiNilaiOrder` ⇒ saat DISETUJUI nilai order berkurang tepat sebesar nominal refund. Prinsipnya NETRAL terhadap sisa tagihan:
//   nilai order −A  dan  uang dipegang −A  ⇒  sisa tagihan tidak berubah (order Lunas tetap Lunas; order DP tidak mendadak punya "sisa" baru).
//
// Mekanismenya satu baris OrderItem pengurang (harga NEGATIF, OrderItem.finRefundId = refund) — BUKAN mengubah Order.value langsung, karena Order.value selalu
// dihitung ulang dari Σ item setiap Sales mengedit item (syncOrderValue); nilai yang diturunkan langsung akan kembali naik pada edit berikutnya dan status
// turun lagi ke DP. Baris ini terkunci dari edit/hapus Sales (routes/orders.js); hanya dibalik di sini saat refund dibatalkan/dikoreksi.
//
// Akuntansi: TIDAK ada jurnal tambahan. Refund yang berlaku setelah pendapatan diakui SUDAH dibukukan Dr Retur & Potongan Penjualan / Cr Bank (posting/orderRevenue.js#postRefund),
// jadi pendapatan bersih = pengakuan bruto − retur = nilai order baru. Menambah penyesuaian pengakuan pendapatan di sini berarti memotong pendapatan DUA KALI.
//
// Batas v1 (menolak dengan pesan jelas, bukan menebak): nominal harus rupiah bulat (Order.value & harga bertipe Int); order dalam Resi gabungan (tagihan per-Resi tidak
// sebanding per order); order Penjualan Karyawan; order dibatalkan; dan nilai order tidak boleh menjadi nol (itu pembatalan order, bukan refund sebagian).
import { toMoney } from "./money.js";
import { recomputeOrderPaymentStatus } from "../paymentLedger.js";

export class RefundNilaiError extends Error {
  constructor(message, statusCode = 409, code = null) {
    super(message);
    this.name = "RefundNilaiError";
    this.statusCode = statusCode;
    if (code) this.code = code;
  }
}

const NAMA_MAKS = 190;

/** Nominal refund sebagai integer rupiah; melempar bila bukan bilangan bulat positif. */
export function rupiahBulat(amount) {
  const m = toMoney(amount);
  if (m.lessThanOrEqualTo(0)) throw new RefundNilaiError("Nominal refund harus lebih dari 0", 400, "NOMINAL_TIDAK_VALID");
  if (!m.mod(1).isZero()) throw new RefundNilaiError("Refund yang mengurangi nilai order harus dalam rupiah bulat (tanpa sen)", 400, "NOMINAL_TIDAK_BULAT");
  return Number(m.toFixed(0));
}

/**
 * Boleh/tidaknya refund pengurang nilai untuk order ini. Dipanggil saat refund DIBUAT dan diulang saat DISETUJUI (keadaan order bisa berubah di antaranya).
 * `ganti` = nilai pengurang refund lama yang akan digantikan (Koreksi) — dikembalikan dulu ke perhitungan supaya batas "tidak boleh nol" adil.
 */
export async function validasiPenguranganNilai(db, { orderId, amount, ganti = 0 }) {
  const nominal = rupiahBulat(amount);
  const o = await db.order.findUnique({ where: { id: orderId }, select: { id: true, value: true, status: true, groupId: true, penjualanKaryawanId: true, staffSellerId: true } });
  if (!o) throw new RefundNilaiError("Order tidak ditemukan", 404, "ORDER_TIDAK_ADA");
  if (o.status === "CANCELLED") throw new RefundNilaiError("Order sudah dibatalkan — tidak ada nilai yang bisa dikurangi", 409, "ORDER_DIBATALKAN");
  if (o.groupId) throw new RefundNilaiError("Order ini bagian dari Resi gabungan — pengurangan nilai lewat refund belum didukung untuk Resi. Gunakan refund biasa lalu sesuaikan lewat Resi.", 409, "ORDER_DALAM_RESI");
  if (o.penjualanKaryawanId) throw new RefundNilaiError("Order Penjualan Karyawan tidak bisa memakai refund pengurang nilai.", 409, "ORDER_PKR");
  const sesudah = o.value + Number(ganti || 0) - nominal;
  if (sesudah <= 0) throw new RefundNilaiError(`Refund ${nominal.toLocaleString("id-ID")} menghabiskan seluruh nilai order (Rp${o.value.toLocaleString("id-ID")}). Untuk membatalkan seluruh pesanan, batalkan order — bukan refund sebagian.`, 409, "NILAI_HABIS");
  return { orderId: o.id, nilaiSebelum: o.value, nilaiSesudah: sesudah, nominal };
}

/** Hitung ulang Order.value = Σ OrderItem.harga (aturan yang sama dengan syncOrderValue di routes/orders.js, tetapi di dalam transaksi pemanggil). */
async function sinkronNilai(tx, orderId) {
  const agg = await tx.orderItem.aggregate({ where: { orderId }, _sum: { harga: true } });
  const total = agg._sum.harga || 0;
  const o = await tx.order.update({ where: { id: orderId }, data: { value: total }, select: { customerId: true } });
  return { total, customerId: o.customerId };
}

/**
 * Terapkan pengurangan saat refund DISETUJUI. Idempoten per refund (satu baris pengurang per refund). Mengembalikan jejak untuk audit.
 * Pemanggil wajib sudah mengunci baris Order & refund dan memanggil recomputeOrderPaymentStatus sesudahnya (sudah dilakukan alur approve/koreksi).
 */
export async function terapkanPenguranganNilai(tx, { refund }) {
  const ada = await tx.orderItem.findFirst({ where: { finRefundId: refund.id }, select: { id: true } });
  if (ada) return { diterapkan: false, alasan: "SUDAH_ADA" };
  const v = await validasiPenguranganNilai(tx, { orderId: refund.orderId, amount: refund.amount });
  const maks = await tx.orderItem.aggregate({ where: { orderId: refund.orderId }, _max: { sortOrder: true } });
  const label = `Refund ${refund.refundNumber} — ${String(refund.reason || "").trim()}`.slice(0, NAMA_MAKS);
  await tx.orderItem.create({
    data: { orderId: refund.orderId, layananName: label, harga: -v.nominal, sortOrder: (maks._max.sortOrder ?? 0) + 1, finRefundId: refund.id },
  });
  const { total, customerId } = await sinkronNilai(tx, refund.orderId);
  return { diterapkan: true, nilaiSebelum: v.nilaiSebelum, nilaiSesudah: total, nominal: v.nominal, customerId };
}

/** Balikkan pengurangan (refund dibatalkan / digantikan Koreksi): hapus baris pengurangnya, nilai order naik kembali. Idempoten. */
export async function balikPenguranganNilai(tx, { refundId, orderId }) {
  const baris = await tx.orderItem.findMany({ where: { finRefundId: refundId }, select: { id: true, harga: true } });
  if (baris.length === 0) return { dibalik: false };
  await tx.orderItem.deleteMany({ where: { finRefundId: refundId } });
  const { total, customerId } = await sinkronNilai(tx, orderId);
  return { dibalik: true, nilaiSesudah: total, nominal: baris.reduce((s, b) => s - b.harga, 0), customerId };
}

/** Status bayar baru setelah nilai berubah. Dipisah supaya pemanggil yang sudah memanggilnya tidak dobel. */
export async function hitungUlangStatusBayar(tx, orderId) {
  return recomputeOrderPaymentStatus(tx, orderId);
}

/** Ringkasan dampak untuk pratinjau/riwayat: refund pengurang nilai yang SUDAH disetujui per order (dipakai diagnosis piutang). */
export async function totalPenguranganDisetujui(db, orderIds) {
  if (!orderIds?.length) return new Map();
  const rows = await db.finRefund.groupBy({
    by: ["orderId"], where: { orderId: { in: orderIds }, kurangiNilaiOrder: true, status: "DISETUJUI" }, _sum: { amount: true },
  });
  return new Map(rows.map((r) => [r.orderId, Number(r._sum.amount ?? 0)]));
}
