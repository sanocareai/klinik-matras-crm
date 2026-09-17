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
// ─── DUA PERUBAHAN DARI D-180 (Finance Workspace, 17 September 2026) ──────
//
// 1. ALOKASI. "Sudah dibayar berapa" tidak lagi sekadar SUM(payments WHERE
//    orderId=...). Satu pembayaran bisa dipecah ke beberapa order
//    (transfer gabungan; invoice gabungan lintas order memang sudah ada di
//    sistem lewat Invoice.combinedIntoId). Perhitungannya pindah ke
//    services/finance/allocation.js#paidForOrder — yang PERILAKU DEFAULT-nya
//    identik dengan rumus lama: payment tanpa alokasi eksplisit dihitung
//    PENUH ke Payment.orderId. Nol perubahan untuk seluruh data yang ada.
//
// 2. GERBANG VERIFIKASI (opsional, DEFAULT MATI).
//
//    Perilaku lama yang TETAP jadi default: SEMUA payment (terverifikasi
//    atau belum) dihitung — verifikasi finance (D-011) adalah audit "uangnya
//    benar sampai ke kas", BUKAN gerbang "apakah customer sudah bayar".
//    Uangnya sudah diterima (ada foto bukti) begitu Payment tercatat.
//
//    Yang ditambahkan: admin bisa MENYALAKAN gerbang di Finance >
//    Pengaturan, sehingga status bayar di CRM hanya bergerak setelah finance
//    memverifikasi. Saat dinyalakan, gerbang HANYA berlaku untuk payment
//    yang dibuat SEJAK saat penyalaan — riwayat tidak pernah berubah surut.
//    Alasan lengkapnya ada di services/finance/allocation.js#isPaymentCounted
//    dan services/finance/settings.js.

import { paidForOrder } from "./finance/allocation.js";
import { getVerificationGate } from "./finance/settings.js";

export async function recomputeOrderPaymentStatus(tx, orderId) {
  const [order, gate] = await Promise.all([
    tx.order.findUnique({ where: { id: orderId }, select: { value: true, paymentStatus: true } }),
    getVerificationGate(tx),
  ]);
  if (!order) return null;

  // cancelledAt: null — entri yang dibatalkan (2 Sep 2026, koreksi salah
  // input) TIDAK ikut dihitung, tapi TETAP ada di tabel (ledger tidak
  // pernah menghapus baris, lihat komentar Payment.cancelledAt di schema).
  // Penyaringan itu sekarang ada di paidForOrder(), bersama penyaringan
  // gerbang verifikasi & alokasi.
  const paidDecimal = await paidForOrder(tx, orderId, gate);
  // Rupiah bulat — Order.value bertipe Int dan status di bawah dibandingkan
  // terhadapnya. Pembulatan HANYA di tepi perbandingan ini; buku besar
  // sendiri tetap menyimpan Decimal apa adanya.
  const paid = Number(paidDecimal.toFixed(0));

  // order.value bisa 0 (belum ada OrderItem sama sekali) — jangan pernah
  // anggap LUNAS hanya karena 0 >= 0, itu "belum dihargai", bukan "lunas".
  const paymentStatus =
    paid <= 0 ? "BELUM_BAYAR" : order.value > 0 && paid >= order.value ? "LUNAS" : "DP";

  // paidAt (30 Agustus 2026) — basis komisi sales, lihat komentar panjang
  // di schema.prisma. Cuma diset saat TRANSISI masuk ke LUNAS (bukan tiap
  // recompute — order yang SUDAH LUNAS lalu dapat Payment susulan/koreksi
  // kecil tidak boleh menggeser paidAt-nya), dan di-null-kan lagi kalau
  // keluar dari LUNAS (koreksi/refund sebagian) supaya paidAt selalu
  // konsisten dengan status SEKARANG, bukan riwayat basi.
  const paidAt =
    paymentStatus === "LUNAS"
      ? (order.paymentStatus === "LUNAS" ? undefined : new Date()) // undefined = jangan sentuh field ini
      : null;

  await tx.order.update({
    where: { id: orderId },
    data: paidAt === undefined ? { paymentStatus } : { paymentStatus, paidAt },
  });
  return { paid, outstanding: Math.max(order.value - paid, 0), paymentStatus };
}
