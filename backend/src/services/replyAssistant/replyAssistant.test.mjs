// Regression Wave 4B.0 (PURE — tanpa DB/LLM/jaringan). Jalankan:
//   node --test src/services/replyAssistant/replyAssistant.test.mjs
// Cakupan: intent gating · validator · cost · fallback template · determinisme ·
// orchestrator (disabled/complaint/handover/quota/budget/provider/scrub/happy).
import { test } from "node:test";
import assert from "node:assert/strict";

import { evaluateGate, primaryIntent } from "./gate.js";
import { hasPromise, scrubSuggestions, enforceSuggestion } from "./validator.js";
import { estimateCostUsd } from "./cost.js";
import { templateSuggestions } from "./templates.js";
import { generateSuggestions } from "./index.js";

// ── stubs ────────────────────────────────────────────────────────────────────
const CONFIG = {
  isEnabled: () => true,
  maxMonthlyCostUsd: () => 20,
  dailyLimit: (role) => (role === "ADMIN" ? 100 : 30),
  model: "claude-haiku-4-5-20251001",
};
function mkDeps(over = {}) {
  const audits = [];
  return {
    _audits: audits,
    getProvider: over.getProvider || (() => null),
    countToday: over.countToday || (async () => 0),
    monthCostUsd: over.monthCostUsd || (async () => 0),
    writeAudit: async (r) => audits.push(r),
    config: { ...CONFIG, ...(over.config || {}) },
  };
}
function spyProvider(text) {
  const state = { called: false };
  const provider = {
    name: "fake",
    async generate() {
      state.called = true;
      return { text, usage: { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, cacheCreateTokens: 0 } };
    },
  };
  return { state, provider };
}
const ctx = (intents = []) => ({ detectedIntents: intents, recentMessages: [{ direction: "INBOUND", text: "halo" }], customer: { stage: "QUOTED" } });
const SALES = { id: "u1", role: "SALES" };

// ── intent gating ────────────────────────────────────────────────────────────
test("gate: complaint & handover diblokir; intent biasa lolos", () => {
  assert.equal(evaluateGate(["COMPLAINT"]).blocked, true);
  assert.equal(evaluateGate(["HANDOVER_REQUEST"]).blocked, true);
  assert.equal(evaluateGate(["PRICE_INQUIRY"]).blocked, false);
  assert.equal(evaluateGate([]).blocked, false);
  assert.equal(primaryIntent(["PRICE_INQUIRY", "SIZE_INQUIRY"]), "PRICE_INQUIRY");
});

// ── validator / promise scrubber ──────────────────────────────────────────────
test("validator: janji harga/diskon/pengiriman terdeteksi & di-scrub", () => {
  assert.equal(hasPromise("harganya Rp5.000.000 ya"), true);
  assert.equal(hasPromise("ada diskon 20% khusus hari ini"), true);
  assert.equal(hasPromise("barang sampai 3 hari"), true);
  assert.equal(hasPromise("Boleh saya bantu pahami keluhannya?"), false);
  const scrubbed = scrubSuggestions([{ text: "Rp5 juta" }, { text: "Boleh dibantu ya" }]);
  assert.equal(scrubbed.length, 1);
});

test("validator: enforceSuggestion selalu requiresHumanReview=true", () => {
  const s = enforceSuggestion({ text: "x", requiresHumanReview: false }, { intent: "PRICE_INQUIRY" });
  assert.equal(s.requiresHumanReview, true);
  assert.equal(s.confidence, null);
});

// ── cost ───────────────────────────────────────────────────────────────────────
test("cost: estimateCostUsd Haiku deterministik", () => {
  const c = estimateCostUsd("claude-haiku-4-5-20251001", { inputTokens: 1_000_000, outputTokens: 1_000_000 });
  assert.equal(c, 1 + 5); // $1/M in + $5/M out
  assert.equal(estimateCostUsd("model-tak-dikenal", { inputTokens: 999 }), 0);
});

// ── template fallback ──────────────────────────────────────────────────────────
test("template: deterministik & tidak pernah menjanjikan apa pun", () => {
  const a = templateSuggestions("PRICE_INQUIRY");
  const b = templateSuggestions("PRICE_INQUIRY");
  assert.deepEqual(a, b);
  for (const s of a) {
    assert.equal(s.requiresHumanReview, true);
    assert.equal(s.source, "template");
    assert.equal(hasPromise(s.text), false);
  }
});

// ── orchestrator ────────────────────────────────────────────────────────────────
test("orchestrator: disabled → BLOCKED ASSISTANT_DISABLED, LLM tak dipanggil", async () => {
  const { state, provider } = spyProvider("[]");
  const deps = mkDeps({ getProvider: () => provider, config: { isEnabled: () => false } });
  const r = await generateSuggestions({ conversationId: "c", customerId: "cu", user: SALES, context: ctx(["PRICE_INQUIRY"]) }, deps);
  assert.equal(r.blocked.reason, "ASSISTANT_DISABLED");
  assert.equal(r.suggestions.length, 0);
  assert.equal(state.called, false);
  assert.equal(deps._audits[0].status, "BLOCKED");
});

test("orchestrator: komplain → BLOCKED, tanpa draf, tanpa LLM", async () => {
  const { state, provider } = spyProvider("[]");
  const deps = mkDeps({ getProvider: () => provider });
  const r = await generateSuggestions({ conversationId: "c", customerId: "cu", user: SALES, context: ctx(["COMPLAINT"]) }, deps);
  assert.equal(r.blocked.reason, "COMPLAINT");
  assert.equal(r.suggestions.length, 0);
  assert.equal(state.called, false);
});

test("orchestrator: kuota harian habis → template, LLM tak dipanggil", async () => {
  const { state, provider } = spyProvider('[{"text":"x"}]');
  const deps = mkDeps({ getProvider: () => provider, countToday: async () => 30 });
  const r = await generateSuggestions({ conversationId: "c", customerId: "cu", user: SALES, context: ctx(["PRICE_INQUIRY"]) }, deps);
  assert.equal(r.source, "template");
  assert.equal(state.called, false);
  assert.ok(r.suggestions.length > 0);
});

test("orchestrator: plafon bulanan tercapai → template, LLM tak dipanggil", async () => {
  const { state, provider } = spyProvider('[{"text":"x"}]');
  const deps = mkDeps({ getProvider: () => provider, monthCostUsd: async () => 999 });
  const r = await generateSuggestions({ conversationId: "c", customerId: "cu", user: SALES, context: ctx(["PRICE_INQUIRY"]) }, deps);
  assert.equal(r.source, "template");
  assert.equal(state.called, false);
});

test("orchestrator: tanpa provider (key hilang) → template", async () => {
  const deps = mkDeps({ getProvider: () => null });
  const r = await generateSuggestions({ conversationId: "c", customerId: "cu", user: SALES, context: ctx(["SIZE_INQUIRY"]) }, deps);
  assert.equal(r.source, "template");
  assert.ok(r.suggestions.every((s) => s.requiresHumanReview === true));
});

test("orchestrator: happy path LLM → source llm, biaya tercatat", async () => {
  const { state, provider } = spyProvider('[{"text":"Boleh saya bantu pahami kebutuhannya?","tone":"hangat"}]');
  const deps = mkDeps({ getProvider: () => provider });
  const r = await generateSuggestions({ conversationId: "c", customerId: "cu", user: SALES, context: ctx(["PRICE_INQUIRY"]) }, deps);
  assert.equal(state.called, true);
  assert.equal(r.source, "llm");
  assert.ok(r.suggestions.length >= 1);
  assert.equal(r.suggestions[0].requiresHumanReview, true);
  const audit = deps._audits[0];
  assert.equal(audit.source, "llm");
  assert.ok(audit.costUsd > 0);
});

test("orchestrator: semua draf LLM melanggar janji → fallback template", async () => {
  const { provider } = spyProvider('[{"text":"harganya Rp5.000.000"},{"text":"diskon 30%"}]');
  const deps = mkDeps({ getProvider: () => provider });
  const r = await generateSuggestions({ conversationId: "c", customerId: "cu", user: SALES, context: ctx(["PRICE_INQUIRY"]) }, deps);
  assert.equal(r.source, "template");
  assert.ok(r.suggestions.every((s) => hasPromise(s.text) === false));
});

test("orchestrator: provider error → template (tetap jalan)", async () => {
  const deps = mkDeps({ getProvider: () => ({ name: "boom", async generate() { throw new Error("down"); } }) });
  const r = await generateSuggestions({ conversationId: "c", customerId: "cu", user: SALES, context: ctx(["PRICE_INQUIRY"]) }, deps);
  assert.equal(r.source, "template");
});

test("orchestrator: determinisme template path (input sama → output sama)", async () => {
  const run = () => generateSuggestions({ conversationId: "c", customerId: "cu", user: SALES, context: ctx(["PRICE_INQUIRY"]) }, mkDeps({ getProvider: () => null }));
  const a = await run();
  const b = await run();
  assert.deepEqual(a.suggestions.map((s) => s.text), b.suggestions.map((s) => s.text));
});
