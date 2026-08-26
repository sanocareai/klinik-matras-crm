// ═══ PRICING — AI Conversation Quality Scorer ═════════════════════════════
// Estimasi harga Claude Haiku 4.5 (USD per 1 JUTA token) — dipakai HANYA
// utk kolom costUsd di baris log/laporan, BUKAN tagihan resmi. Dipisah dari
// job.js (26 Agustus 2026) supaya dipakai bersama oleh job harian (grading
// per-percakapan) & job mingguan (ringkasan naratif pola) tanpa duplikasi
// angka — kalau harga model berubah, cukup edit di satu tempat ini.
export const PRICE_PER_MTOK_USD = { input: 1.0, output: 5.0, cacheRead: 0.1 };

export function estimateCostUsd(usage) {
  const input = (usage.inputTokens || 0) / 1_000_000 * PRICE_PER_MTOK_USD.input;
  const output = (usage.outputTokens || 0) / 1_000_000 * PRICE_PER_MTOK_USD.output;
  const cacheRead = (usage.cacheReadTokens || 0) / 1_000_000 * PRICE_PER_MTOK_USD.cacheRead;
  return Math.round((input + output + cacheRead) * 1_000_000) / 1_000_000;
}
