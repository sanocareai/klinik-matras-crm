// ─── WAVE 4B.0 — PEMBANGUN PAYLOAD KONTRAK (PURE) ───────────────────────────
// Bentuk = FUTURE_SUGGESTION_CONTRACT (Wave 4A). requiresHumanReview selalu true
// (dipaksa di validator). Menyertakan trace audit + info kuota.
import { CONTRACT_VERSION } from "../intelligence/replyReadiness.js";
import { ENGINE_VERSION } from "../intelligence/weights.js";

export function makeRequestId() {
  return "req_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function trace(requestId, model) {
  return { engineVersion: ENGINE_VERSION, contractVersion: CONTRACT_VERSION, requestId, model: model || null };
}

// Draf tersedia.
export function suggestionsPayload({ intent, suggestions, quota, requestId, model, source }) {
  return {
    intent: intent || null,
    handoverRecommended: false,
    blocked: null,
    source: source || null, // "llm" | "template" (ringkas untuk UI/audit)
    suggestions,
    quota,
    generatedAt: new Date().toISOString(),
    trace: trace(requestId, model),
  };
}

// Diblokir (komplain/handover/nonaktif) — TIDAK ada draf.
export function blockedPayload({ intent, reason, quota, requestId, model, handoverRecommended = true }) {
  return {
    intent: intent || null,
    handoverRecommended,
    blocked: { reason },
    source: null,
    suggestions: [],
    quota,
    generatedAt: new Date().toISOString(),
    trace: trace(requestId, model),
  };
}
