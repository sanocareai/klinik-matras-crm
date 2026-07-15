// Regression Wave 4B.0.4 — OpenAI provider support (PURE, tanpa OPENAI_API_KEY asli).
//   node --test src/services/replyAssistant/providers/openai.test.mjs
// Cakupan: seleksi provider/model · key hilang → fallback · generasi sukses ·
// provider error → fallback · kompat kontrak · kompat validator · biaya OpenAI.
import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveProviderModel, replyProviderName } from "../config.js";
import { buildProvider, providerFromModel } from "./index.js";
import { getOpenAIKey } from "./keyStore.js";
import { estimateCostUsd } from "../cost.js";
import { generateSuggestions } from "../index.js";
import { hasPromise } from "../validator.js";

// util env (set → jalankan → pulihkan)
function withEnv(env, fn) {
  const saved = {};
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }
  try { return fn(); } finally { for (const k of Object.keys(env)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
}

const CONFIG = { isEnabled: () => true, maxMonthlyCostUsd: () => 1e9, dailyLimit: () => 1e9, model: "gpt-4.1-mini" };
function mkDeps(over = {}) {
  const audits = [];
  return { _audits: audits, getProvider: over.getProvider || (() => null), countToday: async () => 0, monthCostUsd: async () => 0, writeAudit: async (r) => audits.push(r), config: { ...CONFIG, ...(over.config || {}) } };
}
const ctx = (intents = []) => ({ detectedIntents: intents, recentMessages: [{ direction: "INBOUND", text: "halo" }], customer: { stage: "QUOTED" } });
const SALES = { id: "u1", role: "SALES" };
// stub yang meniru OpenAIProvider (name openai) — TANPA panggil SDK asli
const openaiStub = (text) => { const s = { called: false }; return { s, p: { name: "openai", async generate() { s.called = true; return { text, usage: { inputTokens: 800, outputTokens: 100 } }; } } }; };

// ── seleksi provider & model ────────────────────────────────────────────────
test("resolveProviderModel — default claude; openai; override model via env", () => {
  assert.deepEqual(resolveProviderModel("claude"), { provider: "anthropic", model: "claude-haiku-4-5-20251001" });
  assert.deepEqual(resolveProviderModel("openai"), { provider: "openai", model: "gpt-4.1-mini" });
  withEnv({ OPENAI_REPLY_MODEL: "gpt-4.1" }, () => {
    assert.equal(resolveProviderModel("openai").model, "gpt-4.1"); // env override model
  });
  withEnv({ AI_REPLY_PROVIDER: undefined }, () => assert.equal(replyProviderName(), "claude")); // default produksi
});

test("providerFromModel — derivasi provider dari string model (Keputusan #1)", () => {
  assert.equal(providerFromModel("gpt-4.1-mini"), "openai");
  assert.equal(providerFromModel("claude-haiku-4-5-20251001"), "anthropic");
  assert.equal(providerFromModel("gemini-2.5-flash"), "gemini");
});

// ── missing key → fallback (Keputusan #3) ───────────────────────────────────
test("buildProvider('openai') tanpa OPENAI_API_KEY → null (fallback template)", () => {
  withEnv({ OPENAI_API_KEY: undefined }, () => {
    assert.equal(getOpenAIKey(), null);
    assert.equal(buildProvider("openai"), null);
  });
});

test("buildProvider('openai') dengan key → instance OpenAIProvider", () => {
  withEnv({ OPENAI_API_KEY: "sk-test-xxx", OPENAI_REPLY_MODEL: undefined }, () => {
    const p = buildProvider("openai");
    assert.ok(p && p.name === "openai" && p.model === "gpt-4.1-mini");
  });
});

test("orchestrator: provider openai tak tersedia (null) → template, tanpa 500", async () => {
  const r = await generateSuggestions({ conversationId: "c", customerId: "cu", user: SALES, context: ctx(["PRICE_INQUIRY"]) }, mkDeps({ getProvider: () => null }));
  assert.equal(r.source, "template");
  assert.ok(r.suggestions.every((x) => x.requiresHumanReview === true));
});

// ── generasi sukses ─────────────────────────────────────────────────────────
test("orchestrator: OpenAI sukses → source llm, biaya tercatat", async () => {
  const { s, p } = openaiStub('[{"text":"Boleh saya bantu pahami kebutuhannya dulu?","tone":"hangat"}]');
  const deps = mkDeps({ getProvider: () => p, config: { model: "gpt-4.1-mini" } });
  const r = await generateSuggestions({ conversationId: "c", customerId: "cu", user: SALES, context: ctx(["PRICE_INQUIRY"]) }, deps);
  assert.equal(s.called, true);
  assert.equal(r.source, "llm");
  assert.equal(r.trace.model, "gpt-4.1-mini");
  assert.ok(deps._audits[0].costUsd > 0); // biaya OpenAI dihitung
});

// ── provider error → fallback ───────────────────────────────────────────────
test("orchestrator: OpenAI error → template (tetap jalan)", async () => {
  const deps = mkDeps({ getProvider: () => ({ name: "openai", async generate() { throw new Error("429"); } }) });
  const r = await generateSuggestions({ conversationId: "c", customerId: "cu", user: SALES, context: ctx(["PRICE_INQUIRY"]) }, deps);
  assert.equal(r.source, "template");
});

// ── kompat kontrak ──────────────────────────────────────────────────────────
test("kontrak: draf OpenAI selalu requiresHumanReview=true", async () => {
  const { p } = openaiStub('[{"text":"Terima kasih, boleh dibantu?","tone":"hangat"},{"text":"Untuk siapa kasurnya?","tone":"informatif"}]');
  const r = await generateSuggestions({ conversationId: "c", customerId: "cu", user: SALES, context: ctx(["SIZE_INQUIRY"]) }, mkDeps({ getProvider: () => p }));
  assert.ok(r.suggestions.length >= 1);
  assert.ok(r.suggestions.every((x) => x.requiresHumanReview === true && x.source === "llm"));
});

// ── kompat validator ────────────────────────────────────────────────────────
test("validator: draf OpenAI yang melanggar janji → di-scrub → template", async () => {
  const { p } = openaiStub('[{"text":"harganya lima juta ya pak"},{"text":"garansi 20 tahun untuk semua"}]');
  const r = await generateSuggestions({ conversationId: "c", customerId: "cu", user: SALES, context: ctx(["PRICE_INQUIRY"]) }, mkDeps({ getProvider: () => p }));
  assert.equal(r.source, "template");
  assert.ok(r.suggestions.every((x) => hasPromise(x.text) === false));
});

// ── biaya OpenAI ────────────────────────────────────────────────────────────
test("cost: estimateCostUsd gpt-4.1-mini > 0; model tak dikenal → 0", () => {
  assert.ok(estimateCostUsd("gpt-4.1-mini", { inputTokens: 1_000_000, outputTokens: 1_000_000 }) > 0);
  assert.equal(estimateCostUsd("gpt-unknown-xyz", { inputTokens: 999 }), 0);
});
