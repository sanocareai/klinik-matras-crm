// Turunkan Order.paymentStatus dari ledger Payment — D-023.
//
// Order.paymentStatus tetap kolom yang ADA (dipakai analytics.js sejak
// sebelum Sano Hub, lihat D-022) — bukan dihapus/digantikan. Yang berubah:
// begitu ADA Payment baru tercatat (dari mana pun — DP sales di konfirmasi
// order, atau driver di stop pengiriman), kolom ini DIHITUNG ULANG otomatis
// dari SUM(payments) vs Order.value, bukan cuma diam menunggu toggle manual.
//
// Dropdown manual di Orders.jsx TETAP ADA — untuk kasus tanpa jejak ledger
// (transfer dikonfirmasi lewat rekening bank di luar sistem, dst). Kalau
// sales override manual SETELAH ini, override itu berlaku sampai ada
// Payment baru lagi yang memicu perhitungan ulang.
//
// SEMUA payment (terverifikasi atau belum) DIHITUNG — verifikasi finance
// (D-011) adalah audit "uangnya benar sampai ke kas", BUKAN gerbang
// "apakah customer sudah bayar". Uangnya sudah diterima (ada foto bukti)
// begitu Payment tercatat; verifikasi cuma mencocokkan setoran driver.
export async function recomputeOrderPaymentStatus(tx, orderId) {
  const [order, sum] = await Promise.all([
    tx.order.findUnique({ where: { id: orderId }, select: { value: true } }),
    tx.payment.aggregate({ where: { orderId }, _sum: { amount: true } }),
  ]);
  if (!order) return null;

  const paid = sum._sum.amount || 0;
  // order.value bisa 0 (belum ada OrderItem sama sekali) — jangan pernah
  // anggap LUNAS hanya karena 0 >= 0, itu "belum dihargai", bukan "lunas".
  const paymentStatus =
    paid <= 0 ? "BELUM_BAYAR" : order.value > 0 && paid >= order.value ? "LUNAS" : "DP";

  await tx.order.update({ where: { id: orderId }, data: { paymentStatus } });
  return { paid, outstanding: Math.max(order.value - paid, 0), paymentStatus };
}
