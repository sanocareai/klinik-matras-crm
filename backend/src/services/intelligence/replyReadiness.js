// ─── AI REPLY ASSISTANT — READINESS (ARSITEKTUR SAJA, Wave 4A) ───────────────
// TIDAK ada LLM / endpoint / UI / kirim WhatsApp di sini. Hanya menyiapkan:
//   (1) Reply Intent Taxonomy  (2) Conversation Context Schema builder
//   (3) Future Suggestion Response Contract + invariants  (4) Security boundaries
// Implementasi nyata ditunda ke Wave 4B/4C. Lihat wave-4a-implementation-checkpoint §7.

import { KEYWORDS, ENGINE_VERSION } from "./weights.js";

export const CONTEXT_VERSION = "ctx-1.0.0";
export const CONTRACT_VERSION = "reply-contract-1.0.0";

// (1) TAKSONOMI INTENT — kode tetap. handoverRequired = WAJIB manusia (AI tidak
// boleh menyarankan). llmEligible = boleh dibantu draf LLM nanti (4B/4C).
export const INTENT_TAXONOMY = {
  PRICE_INQUIRY:    { re: KEYWORDS.price,       handoverRequired: false, llmEligible: true,  label: "Tanya harga" },
  SIZE_INQUIRY:     { re: KEYWORDS.size,        handoverRequired: false, llmEligible: true,  label: "Tanya ukuran" },
  CATALOG_REQUEST:  { re: KEYWORDS.catalog,     handoverRequired: false, llmEligible: true,  label: "Minta katalog" },
  PROMO_INQUIRY:    { re: KEYWORDS.promo,       handoverRequired: false, llmEligible: true,  label: "Tanya promo" },
  PAYMENT_INQUIRY:  { re: KEYWORDS.installment, handoverRequired: false, llmEligible: true,  label: "Tanya pembayaran" },
  AVAILABILITY:     { re: KEYWORDS.ready,       handoverRequired: false, llmEligible: true,  label: "Tanya ketersediaan" },
  ORDER_INTENT:     { re: KEYWORDS.order,       handoverRequired: false, llmEligible: true,  label: "Sinyal order" },
  SCHEDULING:       { re: KEYWORDS.scheduling,  handoverRequired: false, llmEligible: true,  label: "Tanya jadwal" },
  COMPLAINT:        { re: KEYWORDS.complaint,   handoverRequired: true,  llmEligible: false, label: "Komplain" },
  HANDOVER_REQUEST: { re: KEYWORDS.handover,    handoverRequired: true,  llmEligible: false, label: "Minta bicara orang" },
};

// Deteksi intent (rule-based) dari teks pesan customer. Dipakai signals.js.
// INERT di 4A: hanya menghasilkan data, tidak memicu balasan apa pun.
export function detectIntents(text) {
  if (!text) return [];
  const out = [];
  for (const [code, def] of Object.entries(INTENT_TAXONOMY)) {
    if (def.re.test(text)) out.push(code);
  }
  return out;
}

export function anyHandoverRequired(codes = []) {
  return codes.some((c) => INTENT_TAXONOMY[c]?.handoverRequired);
}

// (2) CONVERSATION CONTEXT SCHEMA — objek turunan (ephemeral, TIDAK disimpan)
// yang KELAK diberikan ke reply assistant. TIDAK dipanggil endpoint manapun di
// 4A (readiness). Pesan di-cap, telepon di-mask. Menyertakan trace audit.
export function buildConversationContext({ conversation, customer, recentMessages = [], intelligence } = {}) {
  const maskPhone = (p) => (p ? p.replace(/(\d{4})\d+(\d{3})/, "$1****$2") : null);
  return {
    conversationId: conversation?.id || null,
    channel: conversation?.channel || null,
    sessionLabel: conversation?.sessionId || null,
    customer: customer ? {
      id: customer.id, name: customer.name || null, phoneMasked: maskPhone(customer.phone),
      stage: customer.pipelineStage,
      isReturning: (customer.orders?.length || 0) >= 1,
      orderCount: customer.orders?.length || 0,
      health: intelligence?.health ? { score: intelligence.health.score, category: intelligence.health.category } : null,
      priority: intelligence?.priority ? { score: intelligence.priority.score } : null,
      opportunity: intelligence?.opportunity ? { score: intelligence.opportunity.score } : null,
    } : null,
    recentMessages: recentMessages.slice(-10).map((m) => ({ direction: m.direction, text: m.content || "", createdAt: m.createdAt })),
    detectedIntents: intelligence?.signals?.detectedIntents || [],
    nextBestAction: intelligence?.nextAction || null,
    meta: { locale: "id-ID", handoverRequired: anyHandoverRequired(intelligence?.signals?.detectedIntents) },
    // AUDIT/TRACE readiness — versi engine/konteks + waktu untuk jejak audit.
    trace: { engineVersion: ENGINE_VERSION, contextVersion: CONTEXT_VERSION, generatedAt: new Date().toISOString() },
  };
}

// (3) FUTURE SUGGESTION RESPONSE CONTRACT — SPEC untuk Wave 4B/4C (belum ada
// endpoint). Invarian keamanan WAJIB dipatuhi implementasi nanti.
export const FUTURE_SUGGESTION_CONTRACT = {
  version: CONTRACT_VERSION,
  // Bentuk respons yang DIRENCANAKAN (dokumentasi):
  shape: {
    intent: "PRIMARY_INTENT_CODE",
    handoverRecommended: false,
    blocked: null, // { reason } bila complaint/handover
    suggestions: [{
      id: "string", text: "string", tone: "informatif|hangat|closing",
      intent: "CODE", source: "template|llm", confidence: "number|null",
      requiresHumanReview: true, // SELALU true
      disclaimers: ["string"],
    }],
    generatedAt: "ISO",
    trace: { engineVersion: "string", contractVersion: "string", requestId: "string" }, // audit
  },
  // INVARIAN KEAMANAN (di-enforce assertContractInvariants):
  invariants: {
    requiresHumanReviewAlwaysTrue: true, // draft-only, tak pernah auto-kirim
    complaintsAndHandoverBlocked: true,  // COMPLAINT/HANDOVER_REQUEST → suggestions:[], blocked
    noAutomaticSending: true,
    noPriceDeliveryDiscountPromises: true,
    auditTraceRequired: true,
  },
};

// Guard invarian — TERSEDIA untuk implementasi 4B/4C (belum dipakai di 4A).
// Melempar bila draf melanggar aturan keras.
export function assertContractInvariants(payload) {
  if (!payload) throw new Error("reply contract: payload kosong");
  const intents = payload._detectedIntents || [];
  if (anyHandoverRequired(intents)) {
    if ((payload.suggestions || []).length > 0 || !payload.blocked)
      throw new Error("reply contract: complaint/handover WAJIB blocked tanpa saran");
  }
  for (const s of payload.suggestions || []) {
    if (s.requiresHumanReview !== true) throw new Error("reply contract: requiresHumanReview WAJIB true");
  }
  return true;
}

// (4) SECURITY BOUNDARIES — dokumentasi untuk implementasi mendatang.
export const SECURITY_BOUNDARIES = [
  "Draft-only, human-in-the-loop: saran = draf; sales edit & kirim MANUAL. Assistant TIDAK pernah mengirim.",
  "TIDAK ada akses ke jalur kirim WAHA/SSE/Inbox (modul terisolasi).",
  "Aturan keras produk: dilarang menjanjikan harga/pengiriman/diskon pasti.",
  "Komplain/marah → handover ke manusia, TIDAK ada saran AI.",
  "Minimalkan PII ke LLM: pesan di-cap, telepon di-mask, tanpa riwayat penuh.",
  "Tanpa training data pelanggan (BYOK/opt-out); utamakan self-hosted.",
  "LLM hanya atas permintaan eksplisit per-percakapan (tombol), dengan cost/rate cap.",
  "Role scoping + audit: hanya percakapan yang boleh diakses; log metadata (siapa/kapan/intent/source).",
];
