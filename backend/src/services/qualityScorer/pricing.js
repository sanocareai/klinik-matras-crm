// ═══ PRICING — AI Conversation Quality Scorer ═════════════════════════════
// Estimasi harga Claude (USD per 1 JUTA token) — dipakai HANYA utk kolom
// costUsd di baris log/laporan, BUKAN tagihan resmi. Dipisah dari job.js
// (26 Agustus 2026) supaya dipakai bersama oleh job harian (grading
// per-percakapan) & job mingguan (ringkasan naratif pola) tanpa duplikasi
// angka — kalau harga model berubah, cukup edit di satu tempat ini.
export const PRICE_PER_MTOK_USD = { input: 1.0, output: 5.0, cacheRead: 0.1 }; // Haiku 4.5 — default job

// Sonnet 4.6 (28 Agustus 2026) — dipakai KHUSUS akuiPresent/galiPresent
// (config/aiModels.js#SANO_QUALITY_SCORER_AKUI_GALI), BUKAN default job.
// Angka SAMA dgn services/providers/index.js#"claude-sonnet-4-6" —
// direplikasi (bukan diimpor) krn modul ini murni Quality Scorer, tidak
// bergantung ke provider pricing tables lain.
export const SONNET_PRICE_PER_MTOK_USD = { input: 3.0, output: 15.0, cacheRead: 0.3 };

export function estimateCostUsd(usage, priceTable = PRICE_PER_MTOK_USD) {
  const input = (usage.inputTokens || 0) / 1_000_000 * priceTable.input;
  const output = (usage.outputTokens || 0) / 1_000_000 * priceTable.output;
  const cacheRead = (usage.cacheReadTokens || 0) / 1_000_000 * priceTable.cacheRead;
  return Math.round((input + output + cacheRead) * 1_000_000) / 1_000_000;
}
