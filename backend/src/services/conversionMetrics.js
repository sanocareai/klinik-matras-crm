// Helper bersama untuk SEMUA perhitungan persentase konversi di analytics.js.
// Sebelum ada file ini, tiap endpoint menulis ulang Math.round(...) sendiri —
// sebagian pakai 1 desimal, sebagian integer, drift yang tidak perlu. Satu
// fungsi murni di sini supaya presisi & null-semantics konsisten di semua
// tempat (mengikuti pola seriesWindow/fillBuckets di analytics.js).
//
// null (BUKAN 0) kalau penyebut 0/null/undefined — "belum ada data" beda dari
// "angkanya nol", dan UI harus bisa membedakan (render "—" vs "0%").
export function pctOrNull(numerator, denominator, decimals = 1) {
  if (!denominator) return null;
  const mult = 10 ** decimals;
  return Math.round((numerator / denominator) * 100 * mult) / mult;
}
