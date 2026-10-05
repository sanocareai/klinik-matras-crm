// GUARD "PAYMENT MENUNGGU VERIFIKASI" — dipakai verifikasi penerimaan order tunggal (penerimaanOrder.js, termasuk Klaim Lunas & verifikasi massal)
// dan verifikasi penerimaan Resi (penerimaanResi.js).
//
// KENAPA ADA. Payment yang dicatat langsung (Sales sebelum 1 Okt, driver, Finance) SUDAH berjurnal Dr Kas/Bank — kas diakui saat dicatat, verifikasi hanyalah audit
// (aturan historis, lihat paymentLedger.js & jembatanKas.js; TIDAK diubah di sini). Saat gerbang verifikasi menyala, Payment menunggu itu tidak ikut menentukan status
// bayar, jadi order tampak "LUNAS belum dicatat". Bila Finance lalu memverifikasi PENERIMAAN, sebuah Payment BARU dibuat dan uang yang sama terbukukan DUA KALI
// (kasus RES-21092026-130, 30 Sep 2026: Bank Rp7,45 jt untuk order Rp3,73 jt).
//
// ATURAN. Hanya Payment AKTIF, BELUM diverifikasi, dan TIDAK TERHITUNG pada sisa tagihan (isPaymentCounted: gerbang verifikasi menyala & dibuat sesudah gate.since)
// yang memblokir — itulah yang tak terlihat oleh perhitungan sisa tetapi sudah berjurnal. Bila gerbang MATI (atau Payment lebih lama dari gate.since), Payment menunggu
// sudah mengurangi sisa, jadi penerimaan berikutnya tidak bisa menggandakan (nominal ≤ sisa) dan DP langsung + verifikasi sisa tetap sah.
// Tidak memblokir:
//   • dibatalkan / ditolak (cancelledAt terisi) → tidak memblokir;
//   • diganti koreksi (baris lama cancelledAt, penggantinya terverifikasi) → tidak memblokir;
//   • terverifikasi → tidak memblokir.
// Pemanggil WAJIB memanggil ini SETELAH mengambil kunci baris order/grup (kunciKanonis / muatGrupResi kunci:true) dan di dalam transaksi yang sama, supaya
// pemeriksaan dilakukan ULANG di bawah kunci dan request paralel tidak menyelinap. Guard ini tidak menulis apa pun.

import { tanggalWIB } from "./cutoff.js";
import { getVerificationGate } from "./settings.js";
import { isPaymentCounted } from "./allocation.js";

export const KODE_PAYMENT_MENUNGGU = "PAYMENT_MENUNGGU_VERIFIKASI";

/**
 * Payment aktif belum-verifikasi untuk satu atau beberapa order (langsung ke order itu, ATAU lewat alokasi — mis. Payment Resi di anchor).
 * Mengembalikan baris dengan nomor order & pencatatnya untuk pesan galat.
 */
export async function pembayaranMenungguVerifikasi(db, orderIds) {
  const ids = [...new Set([orderIds].flat().filter(Boolean))];
  if (ids.length === 0) return [];
  const gate = await getVerificationGate(db);
  const baris = await db.payment.findMany({
    where: {
      cancelledAt: null,
      verifications: { none: {} },
      OR: [{ orderId: { in: ids } }, { finAllocations: { some: { orderId: { in: ids } } } }],
    },
    select: {
      id: true, amount: true, method: true, createdAt: true, cashAccountId: true, orderId: true,
      order: { select: { orderNumber: true } },
      recordedBy: { select: { name: true } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return baris.filter((p) => !isPaymentCounted({ createdAt: p.createdAt, cancelledAt: null, verifications: [] }, gate));
}

const rupiah = (n) => `Rp${Number(n).toLocaleString("id-ID")}`;

/** Pesan Indonesia: menyebut nomor Payment (8 karakter pertama id), nominal, cara bayar, tanggal, pencatat, dan tindakan yang harus dilakukan. */
export function pesanPaymentMenunggu(label, menunggu) {
  const rincian = menunggu
    .map((m) => `Payment ${String(m.id).slice(0, 8)} — ${rupiah(m.amount)}, ${m.method}, ${tanggalWIB(m.createdAt)}${m.recordedBy?.name ? `, dicatat ${m.recordedBy.name}` : ""}`)
    .join("; ");
  return `${label} masih punya ${menunggu.length} pembayaran aktif yang BELUM diverifikasi: ${rincian}. ` +
    "Verifikasi, tolak, atau batalkan Payment lama itu dulu di menu Pembayaran, lalu ulangi. " +
    "Penerimaan baru tidak dibuat supaya uang yang sama tidak tercatat dua kali.";
}
