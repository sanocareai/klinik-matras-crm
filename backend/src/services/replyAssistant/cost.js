// ─── WAVE 4B.0 — ESTIMASI BIAYA (PURE) ──────────────────────────────────────
// Tarif per 1 juta token (USD). Cermin dari services/providers/index.js PRICING —
// sengaja dicopy kecil supaya modul ini terisolasi & bisa di-test tanpa provider.
export const PRICING = {
  "claude-haiku-4-5-20251001": { input: 1, output: 5, cacheRead: 0.1, cacheCreate: 1.25 },
  "claude-sonnet-4-6": { input: 3, output: 15, cacheRead: 0.3, cacheCreate: 3.75 },
  "gemini-2.5-flash": { input: 0.075, output: 0.3, cacheRead: 0, cacheCreate: 0 },
  // Wave 4B.0.4 — OpenAI. Model tak dikenal → estimasi 0 (aman, tidak crash).
  "gpt-4.1-mini": { input: 0.4, output: 1.6, cacheRead: 0.1, cacheCreate: 0 },
};

// Hitung estimasi biaya 1 panggilan dari usage token. Deterministik.
export function estimateCostUsd(model, usage) {
  const p = PRICING[model] || {};
  const u = usage || {};
  return (
    (u.inputTokens || 0) * (p.input || 0) +
    (u.outputTokens || 0) * (p.output || 0) +
    (u.cacheReadTokens || 0) * (p.cacheRead || 0) +
    (u.cacheCreateTokens || 0) * (p.cacheCreate || 0)
  ) / 1_000_000;
}
