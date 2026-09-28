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

import { paidForOrder, isPaymentCounted, kontribusiPembayaranOrder } from "./finance/allocation.js";
import { getVerificationGate } from "./finance/settings.js";
import { PILIH_TAGIHAN, dasarStatusBayar } from "./finance/tagihanOrder.js";

const tanggalWIB = (d) => new Date(new Date(d).getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);

/**
 * TANGGAL LUNAS EFEKTIF (B3.7): tanggal pembayaran yang PERTAMA KALI membuat total pembayaran yang dihitung mencapai tagihan kanonis `dasar`.
 * Pembayaran (kontribusi sadar-alokasi, yang dihitung menurut gerbang verifikasi) diurutkan menurut TANGGAL efektif (hari WIB dari Payment.createdAt) lalu ID,
 * dijumlahkan kumulatif; yang melewati titik lunas menentukan tanggalnya (bukan waktu koreksi/pencatatan). Belum mencapai → null.
 */
export async function tanggalLunasEfektif(tx, orderId, { gate, dasar }) {
  if (!(dasar > 0)) return null;
  const daftar = await kontribusiPembayaranOrder(tx, orderId, { select: { verifications: { select: { id: true } } } });
  const dihitung = daftar.filter((c) => isPaymentCounted({ createdAt: c.createdAt, cancelledAt: null, verifications: c.verifications }, gate));
  dihitung.sort((a, b) => (tanggalWIB(a.createdAt) < tanggalWIB(b.createdAt) ? -1 : tanggalWIB(a.createdAt) > tanggalWIB(b.createdAt) ? 1 : (a.id < b.id ? -1 : 1)));
  let kumulatif = 0;
  for (const c of dihitung) {
    kumulatif += Number(c.amount) || 0;
    if (kumulatif >= dasar) return c.createdAt;
  }
  return null;
}

/**
 * `paidAtEfektif` (default false): dipakai koreksi pembayaran (B3.7) untuk order yang terdampak — paidAt SELALU dihitung ulang dari ledger
 * (tanggal pembayaran yang melewati titik lunas, atau null bila belum lunas), tidak pernah waktu koreksi. Tanpa opsi ini (semua alur lama), order yang
 * SUDAH LUNAS tidak digeser paidAt-nya (aturan lama); saat MASUK ke LUNAS paidAt = tanggal pembayaran pelunas (fallback: sekarang).
 */
export async function recomputeOrderPaymentStatus(tx, orderId, { paidAtEfektif = false } = {}) {
  const [order, gate] = await Promise.all([
    tx.order.findUnique({ where: { id: orderId }, select: { ...PILIH_TAGIHAN, paymentStatus: true } }),
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
  // Pembanding dari helper KANONIS (services/finance/tagihanOrder.js): order tunggal / BACKFILL = Order.value (aturan lama, tidak berubah);
  // child Resi BARU = value + Ongkir Tambahan (hanya di anchor) — "Lunas" berarti seluruh Total Resi bagian order itu terbayar.
  const dasar = dasarStatusBayar(order);
  const paymentStatus =
    paid <= 0 ? "BELUM_BAYAR" : order.value > 0 && paid >= dasar ? "LUNAS" : "DP";

  // paidAt (30 Agustus 2026) — basis komisi sales, lihat komentar panjang
  // di schema.prisma. Cuma diset saat TRANSISI masuk ke LUNAS (bukan tiap
  // recompute — order yang SUDAH LUNAS lalu dapat Payment susulan/koreksi
  // kecil tidak boleh menggeser paidAt-nya), dan di-null-kan lagi kalau
  // keluar dari LUNAS (koreksi/refund sebagian) supaya paidAt selalu
  // konsisten dengan status SEKARANG, bukan riwayat basi.
  let paidAt;
  if (paymentStatus !== "LUNAS") paidAt = null;
  else if (order.paymentStatus === "LUNAS" && !paidAtEfektif) paidAt = undefined; // undefined = jangan sentuh field ini
  else paidAt = (await tanggalLunasEfektif(tx, orderId, { gate, dasar })) ?? new Date();

  await tx.order.update({
    where: { id: orderId },
    data: paidAt === undefined ? { paymentStatus } : { paymentStatus, paidAt },
  });
  return { paid, outstanding: Math.max(dasar - paid, 0), paymentStatus };
}
