// Perhitungan diskon promo/voucher — SATU sumber untuk invoice, pesan WA, dan pemeriksaan batas (8 Okt 2026).
//
// Promo hanya PENANDA: harga final tiap item diketik sales (OrderItem.harga). Yang dilakukan modul ini:
//  1. hitungDiskonPromo  — "harga sebelum diskon" untuk TAMPILAN (invoice & WA), dihitung mundur dari harga final dan persen
//     promo, lalu dipotong oleh batas maksimal Rupiah promo bila ada (Promo.maxDiscountAmount).
//  2. periksaBatasDiskon — peringatan bila diskon yang BENAR-BENAR diberikan melampaui batas Rupiah promo.
//
// "Diskon yang diberikan" diukur dari selisih harga final ke harga STANDARD katalog (OrderItem.standardPrice, harga yang boleh
// ditawarkan sales) — ukuran yang sama dengan penanda "Rp X di bawah standard" yang sudah tampil di form order. Item tanpa harga
// standard (ketik bebas) tidak bisa dinilai sehingga tidak dihitung; item di atas standard tidak "menutupi" item lain.
// Peringatan ini TIDAK memblokir penyimpanan: form web/app menyimpan order dulu lalu item satu per satu, sehingga blokir keras
// di tahap item meninggalkan order setengah jadi.

/** Bersihkan angka batas dari input apa pun → bilangan bulat > 0, atau null (tanpa batas). */
export function normalisasiBatasDiskon(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return NaN;
  return n;
}

/**
 * @param {{ totalFinal: number, promo?: { discountPercent?: number|null, maxDiscountAmount?: number|null } | null }} p
 * @returns {{ hargaSebelumDiskon: number, nilaiDiskon: number, terpotongBatas: boolean }}
 */
export function hitungDiskonPromo({ totalFinal, promo }) {
  const final = Number(totalFinal) || 0;
  const persen = promo?.discountPercent;
  if (!persen || persen <= 0 || persen >= 100) return { hargaSebelumDiskon: final, nilaiDiskon: 0, terpotongBatas: false };
  const mentah = Math.round(final / (1 - persen / 100)) - final;
  const batas = promo?.maxDiscountAmount;
  const terpotongBatas = batas != null && mentah > batas;
  const nilaiDiskon = terpotongBatas ? batas : mentah;
  return { hargaSebelumDiskon: final + nilaiDiskon, nilaiDiskon, terpotongBatas };
}

/**
 * @param {{ items: Array<{harga:number, standardPrice?:number|null}>, promo?: { code?: string, maxDiscountAmount?: number|null } | null }} p
 * @returns {null | { kode: string|null, batas: number, diskon: number, lebih: number, melebihi: boolean }}
 *   null = tidak ada promo / promo tanpa batas.
 */
export function periksaBatasDiskon({ items, promo }) {
  const batas = promo?.maxDiscountAmount;
  if (batas == null) return null;
  let diskon = 0;
  for (const it of items || []) {
    if (it?.standardPrice == null) continue;
    const selisih = Number(it.standardPrice) - (Number(it.harga) || 0);
    if (selisih > 0) diskon += selisih;
  }
  return { kode: promo.code || null, batas, diskon, lebih: Math.max(0, diskon - batas), melebihi: diskon > batas };
}
