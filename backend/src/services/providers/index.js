import * as anthropicProvider from "./anthropicProvider.js";
import * as openaiProvider    from "./openaiProvider.js";
import * as geminiProvider    from "./geminiProvider.js";

// Tarif per 1 juta token (USD) — verifikasi harga terbaru di pricing page masing-masing
const PRICING = {
  "claude-sonnet-4-6":         { input: 3,     output: 15,   cacheRead: 0.30, cacheCreate: 3.75 },
  "claude-haiku-4-5-20251001": { input: 1,     output: 5,    cacheRead: 0.10, cacheCreate: 1.25 },
  "gpt-5.5":                   { input: 2.5,   output: 10,   cacheRead: 0.25, cacheCreate: 0    },
  "gpt-5.4-mini":              { input: 0.4,   output: 1.6,  cacheRead: 0.04, cacheCreate: 0    },
  "gemini-2.5-flash":          { input: 0.075, output: 0.30, cacheRead: 0,    cacheCreate: 0    },
  "gemini-2.5-pro":            { input: 1.25,  output: 10.0, cacheRead: 0,    cacheCreate: 0    },
};

/**
 * Log pemakaian AI ke console — format seragam untuk semua provider
 * [Chat] endpoint provider=anthropic model=claude-haiku ... estimasi=$0.000123
 */
export function logChatUsage(endpoint, provider, model, usage) {
  if (!usage) return;
  const p = PRICING[model] || {};
  const cost = (
    (usage.inputTokens       * (p.input       || 0)) +
    (usage.outputTokens      * (p.output      || 0)) +
    (usage.cacheReadTokens   * (p.cacheRead   || 0)) +
    (usage.cacheCreateTokens * (p.cacheCreate || 0))
  ) / 1_000_000;

  let cacheTag = "";
  if (provider === "anthropic") {
    if (usage.cacheReadTokens   > 0) cacheTag = " cache=HIT✓";
    else if (usage.cacheCreateTokens > 0) cacheTag = " cache=CREATE";
  } else if (usage.cacheReadTokens > 0) {
    cacheTag = " cache=HIT✓(auto)";
  }

  console.log(
    `[Chat] ${endpoint} provider=${provider} model=${model}` +
    ` in=${usage.inputTokens} out=${usage.outputTokens}${cacheTag}` +
    (cost > 0 ? ` estimasi=$${cost.toFixed(6)}` : "")
  );
}

/**
 * Router utama — pilih provider berdasarkan field "provider" dari config model
 * Mendukung: "anthropic" | "openai" | "gemini"
 */
export async function chatWithModel({ provider, apiKey, model, systemPrompt, messages, maxTokens }) {
  if (provider === "anthropic") {
    return anthropicProvider.chat({ apiKey, model, systemPrompt, messages, maxTokens });
  }
  if (provider === "openai") {
    return openaiProvider.chat({ apiKey, model, systemPrompt, messages, maxTokens });
  }
  if (provider === "gemini") {
    return geminiProvider.chat({ apiKey, model, systemPrompt, messages, maxTokens });
  }
  throw new Error(`Provider tidak dikenal: ${provider}`);
}

// Re-export provider langsung untuk copilot (perlu chatWithTools Anthropic)
export { anthropicProvider, geminiProvider };
