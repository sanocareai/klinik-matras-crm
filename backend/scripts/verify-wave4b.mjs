// ═══ VERIFIKASI WAVE 4B.0 — Reply Assistant (gateway/contract/validator) ═════
// Mandiri: TANPA server/DB/LLM/jaringan. Cek keamanan + kontrak di level modul +
// grep isolasi import. Jalankan dari folder backend:
//   node scripts/verify-wave4b.mjs
// Exit 0 = semua lulus, exit 1 = ada yang gagal.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { generateSuggestions } from "../src/services/replyAssistant/index.js";
import { evaluateGate } from "../src/services/replyAssistant/gate.js";
import { hasPromise, scrubSuggestions } from "../src/services/replyAssistant/validator.js";
import { canAccessCustomer } from "../src/services/replyAssistant/scope.js";
import { buildConversationContext } from "../src/services/intelligence/replyReadiness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE_DIR = path.join(__dirname, "../src/services/replyAssistant");

let pass = 0, fail = 0;
const ok = (name) => { pass++; console.log(`  ✓ ${name}`); };
const bad = (name, detail) => { fail++; console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); };
function check(name, cond, detail) { cond ? ok(name) : bad(name, detail); }

const CONFIG = {
  isEnabled: () => true, maxMonthlyCostUsd: () => 20,
  dailyLimit: (r) => (r === "ADMIN" ? 100 : 30), model: "claude-haiku-4-5-20251001",
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
  return { state, provider: { name: "fake", async generate() { state.called = true; return { text, usage: { inputTokens: 500, outputTokens: 100 } }; } } };
}
const ctx = (intents = []) => ({ detectedIntents: intents, recentMessages: [{ direction: "INBOUND", text: "halo" }], customer: { stage: "QUOTED" } });
const SALES = { id: "u1", role: "SALES" };

const ALLOWED_SUGGESTION_KEYS = new Set(["id", "text", "tone", "intent", "source", "confidence", "requiresHumanReview", "disclaimers"]);

async function run() {
  console.log("\n=== WAVE 4B.0 VERIFICATION ===\n");

  // 1. Contract shape
  console.log("[1] Bentuk kontrak");
  {
    const { provider } = spyProvider('[{"text":"Boleh saya bantu?","tone":"hangat"}]');
    const r = await generateSuggestions({ conversationId: "c", customerId: "cu", user: SALES, context: ctx(["PRICE_INQUIRY"]) }, mkDeps({ getProvider: () => provider }));
    check("payload punya field wajib", ["intent", "handoverRecommended", "blocked", "suggestions", "generatedAt", "trace"].every((k) => k in r));
    check("trace punya engineVersion+contractVersion+requestId", r.trace && r.trace.engineVersion && r.trace.contractVersion && r.trace.requestId);
    check("suggestion punya requiresHumanReview=true", r.suggestions.every((s) => s.requiresHumanReview === true));
    check("suggestion hanya field yang diizinkan (no leak)", r.suggestions.every((s) => Object.keys(s).every((k) => ALLOWED_SUGGESTION_KEYS.has(k))));
  }

  // 2. Complaint blocked
  console.log("[2] Komplain diblokir");
  {
    const { state, provider } = spyProvider("[]");
    const r = await generateSuggestions({ conversationId: "c", customerId: "cu", user: SALES, context: ctx(["COMPLAINT"]) }, mkDeps({ getProvider: () => provider }));
    check("evaluateGate(COMPLAINT).blocked", evaluateGate(["COMPLAINT"]).blocked === true);
    check("payload blocked=COMPLAINT & suggestions kosong", r.blocked?.reason === "COMPLAINT" && r.suggestions.length === 0);
    check("LLM TIDAK dipanggil untuk komplain", state.called === false);
  }

  // 3. Handover blocked
  console.log("[3] Handover diblokir");
  {
    const { state, provider } = spyProvider("[]");
    const r = await generateSuggestions({ conversationId: "c", customerId: "cu", user: SALES, context: ctx(["HANDOVER_REQUEST"]) }, mkDeps({ getProvider: () => provider }));
    check("payload blocked=HANDOVER_REQUEST, tanpa draf", r.blocked?.reason === "HANDOVER_REQUEST" && r.suggestions.length === 0);
    check("LLM TIDAK dipanggil untuk handover", state.called === false);
  }

  // 4. Promise scrubber
  console.log("[4] Promise scrubber");
  {
    check("harga nominal terdeteksi", hasPromise("harganya Rp5.000.000"));
    check("diskon persen terdeteksi", hasPromise("diskon 25% hari ini"));
    check("janji pengiriman terdeteksi", hasPromise("dikirim 2 hari sampai"));
    check("kalimat aman lolos", hasPromise("Boleh dibantu pahami kebutuhannya?") === false);
    check("scrub membuang draf melanggar", scrubSuggestions([{ text: "Rp5jt" }, { text: "aman ya" }]).length === 1);
    const { provider } = spyProvider('[{"text":"harganya Rp9.000.000"}]');
    const r = await generateSuggestions({ conversationId: "c", customerId: "cu", user: SALES, context: ctx(["PRICE_INQUIRY"]) }, mkDeps({ getProvider: () => provider }));
    check("semua draf melanggar → fallback template aman", r.source === "template" && r.suggestions.every((s) => hasPromise(s.text) === false));
  }

  // 5. Role isolation
  console.log("[5] Role isolation");
  {
    check("ADMIN akses semua", canAccessCustomer({ assignedSalesId: "other" }, { id: "a", role: "ADMIN" }) === true);
    check("SALES akses miliknya", canAccessCustomer({ assignedSalesId: "u1" }, SALES) === true);
    check("SALES akses unassigned (claimable)", canAccessCustomer({ assignedSalesId: null }, SALES) === true);
    check("SALES DITOLAK milik sales lain", canAccessCustomer({ assignedSalesId: "u2" }, SALES) === false);
  }

  // 6. Cost limit behavior
  console.log("[6] Batas biaya/kuota");
  {
    const d1 = spyProvider('[{"text":"x"}]');
    const r1 = await generateSuggestions({ conversationId: "c", customerId: "cu", user: SALES, context: ctx(["PRICE_INQUIRY"]) }, mkDeps({ getProvider: () => d1.provider, countToday: async () => 30 }));
    check("kuota harian habis → template, tanpa LLM", r1.source === "template" && d1.state.called === false);
    const d2 = spyProvider('[{"text":"x"}]');
    const r2 = await generateSuggestions({ conversationId: "c", customerId: "cu", user: SALES, context: ctx(["PRICE_INQUIRY"]) }, mkDeps({ getProvider: () => d2.provider, monthCostUsd: async () => 999 }));
    check("plafon bulanan → template, tanpa LLM", r2.source === "template" && d2.state.called === false);
    check("ADMIN kuota 100 > SALES 30", CONFIG.dailyLimit("ADMIN") === 100 && CONFIG.dailyLimit("SALES") === 30);
  }

  // 7. Disabled flag
  console.log("[7] Kill switch REPLY_ASSISTANT_ENABLED");
  {
    const { state, provider } = spyProvider("[]");
    const r = await generateSuggestions({ conversationId: "c", customerId: "cu", user: SALES, context: ctx(["PRICE_INQUIRY"]) }, mkDeps({ getProvider: () => provider, config: { isEnabled: () => false } }));
    check("disabled → blocked ASSISTANT_DISABLED", r.blocked?.reason === "ASSISTANT_DISABLED" && r.suggestions.length === 0);
    check("disabled → LLM tidak dipanggil", state.called === false);
  }

  // 8. No field leaks (PII masking)
  console.log("[8] Tanpa kebocoran PII");
  {
    const RAW_PHONE = "628123456789";
    const context = buildConversationContext({
      conversation: { id: "cv", channel: "WHATSAPP", sessionId: "CS-1" },
      customer: { id: "cu", name: "Budi", phone: RAW_PHONE, pipelineStage: "QUOTED", orders: [] },
      recentMessages: [{ direction: "INBOUND", content: "tanya harga", createdAt: new Date().toISOString() }],
      intelligence: { signals: { detectedIntents: ["PRICE_INQUIRY"] }, health: { score: 70, category: "Sehat" }, nextAction: null },
    });
    check("phone di-mask di context", context.customer.phoneMasked && !context.customer.phoneMasked.includes(RAW_PHONE));
    const { provider } = spyProvider('[{"text":"Boleh dibantu ya?","tone":"hangat"}]');
    const r = await generateSuggestions({ conversationId: "cv", customerId: "cu", user: SALES, context }, mkDeps({ getProvider: () => provider }));
    check("nomor telepon mentah TIDAK muncul di payload", !JSON.stringify(r).includes(RAW_PHONE));
  }

  // 9. Import isolation — modul TIDAK boleh import waha/socket/sse/sendMessage/broadcast
  console.log("[9] Isolasi import (grep)");
  {
    const forbidden = /waha|socket|sse|sendmessage|broadcast/i;
    const files = [];
    (function walk(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".js") || e.name.endsWith(".mjs")) files.push(p);
      }
    })(MODULE_DIR);
    let violations = [];
    for (const f of files) {
      const src = fs.readFileSync(f, "utf-8");
      const importPaths = [...src.matchAll(/(?:import[^'"]*from|require\()\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
      for (const ip of importPaths) {
        if (ip.startsWith("node:")) continue; // builtin aman (mis. node:assert) — bukan modul internal terlarang
        if (forbidden.test(ip)) violations.push(`${path.basename(f)} → ${ip}`);
      }
    }
    check(`tidak ada import terlarang (${files.length} file dipindai)`, violations.length === 0, violations.join("; "));
  }

  console.log(`\n=== HASIL: ${pass} lulus, ${fail} gagal ===\n`);
  if (fail > 0) process.exit(1);
  console.log("SEMUA LULUS ✓\n");
}

run().catch((e) => { console.error("VERIFY ERROR:", e); process.exit(1); });
