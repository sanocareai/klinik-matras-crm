// ═══ WAVE 4B.0 — REPLY ASSISTANT ORCHESTRATOR ═══════════════════════════════
// Satu titik choke untuk SETIAP draf balasan. PURE terhadap IO: semua akses luar
// (context, provider, penghitung kuota, audit) diinjeksi lewat `deps` → orchestrator
// bisa di-test penuh tanpa DB/LLM/jaringan. TIDAK meng-import WAHA/socket/SSE/
// send-path apa pun (diverifikasi grep di verify-wave4b.mjs).
//
// Urutan: kill switch → gate (komplain/handover) → kuota+budget → LLM → validator
//          → template fallback → audit. LLM TIDAK PERNAH dipanggil melewati batas.
import { primaryIntent, evaluateGate } from "./gate.js";
import { buildKbSlice } from "./kbSlice.js";
import { templateSuggestions } from "./templates.js";
import { scrubSuggestions, enforceSuggestion, assertPayload } from "./validator.js";
import { suggestionsPayload, blockedPayload, makeRequestId } from "./contract.js";
import { buildSystemPrompt, buildUserPrompt, parseSuggestions } from "./prompt.js";
import { estimateCostUsd } from "./cost.js";

const MAX_SUGGESTIONS = 3;
const MAX_OUTPUT_TOKENS = 350;

export async function generateSuggestions({ conversationId, customerId, user, context }, deps) {
  const { getProvider, countToday, monthCostUsd, writeAudit, config } = deps;

  const requestId = makeRequestId();
  const model = config.model;
  const intents = context?.detectedIntents || [];
  const intent = primaryIntent(intents);
  const baseAudit = { conversationId: conversationId || null, customerId: customerId || null, userId: user.id, intent };

  // Tulis audit lalu tegakkan invarian kontrak, baru kembalikan payload.
  async function finalize(payload, auditPatch) {
    try {
      await writeAudit({ ...baseAudit, ...auditPatch });
    } catch {
      // audit gagal tidak boleh menjatuhkan fitur (best-effort)
    }
    assertPayload(payload, intents);
    return payload;
  }

  // 1) MASTER KILL SWITCH
  if (!config.isEnabled()) {
    const payload = blockedPayload({ intent, reason: "ASSISTANT_DISABLED", quota: null, requestId, model: null, handoverRecommended: false });
    return finalize(payload, { status: "BLOCKED", blocked: true, blockedReason: "ASSISTANT_DISABLED", source: null, suggestionCount: 0 });
  }

  // 2) SECURITY GATE — komplain/handover → WAJIB manusia, tanpa draf
  const gate = evaluateGate(intents);
  if (gate.blocked) {
    const payload = blockedPayload({ intent, reason: gate.reason, quota: null, requestId, model: null });
    return finalize(payload, { status: "BLOCKED", blocked: true, blockedReason: gate.reason, source: null, suggestionCount: 0 });
  }

  // 3) KUOTA HARIAN + PLAFON BULANAN → fallback template (JANGAN panggil LLM)
  const limit = config.dailyLimit(user.role);
  const used = await countToday();
  const remaining = Math.max(0, limit - used);
  const quota = { remaining, limit };
  const overDaily = used >= limit;
  const overBudget = (await monthCostUsd()) >= config.maxMonthlyCostUsd();

  if (overDaily || overBudget) {
    return finalize(
      suggestionsPayload({ intent, suggestions: templateSuggestions(intent), quota, requestId, model: null, source: "template" }),
      { status: "GENERATED", source: "template", suggestionCount: templateSuggestions(intent).length, costUsd: 0 }
    );
  }

  // 4) GENERATE via LLM (dengan fallback bila key hilang / provider gagal)
  const provider = getProvider();
  if (!provider) {
    return finalize(
      suggestionsPayload({ intent, suggestions: templateSuggestions(intent), quota, requestId, model: null, source: "template" }),
      { status: "GENERATED", source: "template", suggestionCount: templateSuggestions(intent).length, costUsd: 0 }
    );
  }

  try {
    const systemPrompt = buildSystemPrompt(buildKbSlice(intents));
    const userPrompt = buildUserPrompt(context);
    const { text, usage } = await provider.generate({ systemPrompt, userPrompt, maxTokens: MAX_OUTPUT_TOKENS });

    const cost = estimateCostUsd(model, usage);
    let drafts = parseSuggestions(text)
      .slice(0, MAX_SUGGESTIONS)
      .map((s) => enforceSuggestion(s, { intent, source: "llm" }));
    drafts = scrubSuggestions(drafts); // buang janji harga/pengiriman/diskon

    if (!drafts.length) {
      // semua ke-scrub → template aman (biaya LLM tetap dicatat)
      const tpl = templateSuggestions(intent);
      return finalize(
        suggestionsPayload({ intent, suggestions: tpl, quota, requestId, model: null, source: "template" }),
        { status: "GENERATED", source: "template", suggestionCount: tpl.length, model, inputTokens: usage?.inputTokens || 0, outputTokens: usage?.outputTokens || 0, costUsd: cost }
      );
    }

    return finalize(
      suggestionsPayload({ intent, suggestions: drafts, quota: { remaining: Math.max(0, remaining - 1), limit }, requestId, model, source: "llm" }),
      { status: "GENERATED", source: "llm", suggestionCount: drafts.length, model, inputTokens: usage?.inputTokens || 0, outputTokens: usage?.outputTokens || 0, costUsd: cost }
    );
  } catch {
    // Provider tidak tersedia → template (fitur tetap jalan)
    const tpl = templateSuggestions(intent);
    return finalize(
      suggestionsPayload({ intent, suggestions: tpl, quota, requestId, model: null, source: "template" }),
      { status: "GENERATED", source: "template", suggestionCount: tpl.length, costUsd: 0 }
    );
  }
}
