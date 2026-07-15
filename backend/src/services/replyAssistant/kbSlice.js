// ─── WAVE 4B.0 — LEAN INTENT-KEYED KB SLICE (PURE) ──────────────────────────
// BUKAN seluruh Knowledge Base — hanya panduan singkat & aman per-intent untuk
// menuntun model (hemat token, deterministik). Nanti bisa diganti pengambilan
// dari data/knowledge/*.md; untuk 4B.0 dibuat inline & konservatif.
const SLICES = {
  PRICE_INQUIRY:
    "Ada 2 paket (Standard & Premium). JANGAN sebut nominal harga — arahkan bahwa tim akan konfirmasi harga final sesuai kebutuhan.",
  PROMO_INQUIRY:
    "JANGAN menjanjikan diskon/promo. Arahkan customer ke tim untuk promo yang sedang berlaku.",
  PAYMENT_INQUIRY:
    "Opsi pembayaran/cicilan dikonfirmasi tim. Jangan janjikan skema/tenor spesifik.",
  SIZE_INQUIRY:
    "Ukuran umum: 90/100/120/160/180/200. Tanyakan pemakai & berat badan untuk rekomendasi presisi.",
  CATALOG_REQUEST:
    "Tawarkan mengirim katalog/foto lewat tim. Fokus pahami kebutuhan tidur dulu.",
  AVAILABILITY:
    "Ketersediaan/stok dikonfirmasi tim. Jangan pastikan ready tanpa cek.",
  ORDER_INTENT:
    "Customer menunjukkan sinyal order — bantu arahkan langkah, konfirmasi kebutuhan; detail final oleh tim.",
  SCHEDULING:
    "Jadwal/pengiriman dikonfirmasi tim. JANGAN janjikan tanggal/estimasi waktu spesifik.",
  DEFAULT:
    "Konsultatif & hangat (positioning 'Ahlinya Kasur Sehat'): pahami keluhan tidur dulu, jangan menjanjikan harga/pengiriman/diskon.",
};

// Gabungkan slice untuk intent yang terdeteksi (maks beberapa, singkat).
export function buildKbSlice(intents = []) {
  const parts = [];
  for (const code of intents) {
    if (SLICES[code] && !parts.includes(SLICES[code])) parts.push(SLICES[code]);
  }
  if (!parts.length) parts.push(SLICES.DEFAULT);
  return parts.join(" ");
}
