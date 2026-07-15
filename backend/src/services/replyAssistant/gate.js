// ─── WAVE 4B.0 — SECURITY GATE (PURE) ───────────────────────────────────────
// Lapis pertama RULE-BASED (tanpa LLM): kalau intent mengandung COMPLAINT atau
// HANDOVER_REQUEST → WAJIB handover manusia, TIDAK boleh ada draf AI sama sekali.
// Taksonomi & aturan handover diambil dari Wave 4A replyReadiness.js.
import { INTENT_TAXONOMY, anyHandoverRequired } from "../intelligence/replyReadiness.js";

// Intent utama = intent llmEligible pertama; kalau tidak ada, intent pertama.
export function primaryIntent(intents = []) {
  if (!intents.length) return null;
  return intents.find((c) => INTENT_TAXONOMY[c]?.llmEligible) || intents[0];
}

// Evaluasi gate → { blocked, reason }. reason = kode intent yang memicu blokir.
export function evaluateGate(intents = []) {
  if (anyHandoverRequired(intents)) {
    const reason = intents.find((c) => INTENT_TAXONOMY[c]?.handoverRequired) || "HANDOVER_REQUEST";
    return { blocked: true, reason };
  }
  return { blocked: false, reason: null };
}
