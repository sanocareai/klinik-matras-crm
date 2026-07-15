// ─── WAVE 4B.0.4 — PEMILIHAN PROVIDER (TERKONTROL, TANPA ROUTING OTOMATIS) ───
// Produksi memilih via AI_REPLY_PROVIDER (default claude). Orchestrator TIDAK tahu
// provider mana — ia hanya memanggil getProvider(). Kalau key tak ada / provider
// belum aktif → null → orchestrator fallback ke template (perilaku existing).
import { ClaudeProvider } from "./ClaudeProvider.js";
import { OpenAIProvider } from "./OpenAIProvider.js";
import { GeminiProvider } from "./GeminiProvider.js";
import { getAnthropicKey, getOpenAIKey } from "./keyStore.js";
import { resolveProviderModel, replyProviderName } from "../config.js";

// Keputusan #1: TANPA kolom schema `provider`. Diturunkan dari string model
// (dipakai untuk pelaporan/kalibrasi/audit, tidak dipersist selain `model`).
export function providerFromModel(model = "") {
  const m = String(model).toLowerCase();
  if (m.startsWith("gpt") || m.startsWith("o1") || m.startsWith("o3") || m.startsWith("o4")) return "openai";
  if (m.startsWith("gemini")) return "gemini";
  if (m.startsWith("claude")) return "anthropic";
  return "unknown";
}

// Bangun provider untuk NAMA tertentu (dipakai produksi via getActiveProvider,
// dan kalibrasi via harness). null → fallback template.
export function buildProvider(name) {
  const { provider, model } = resolveProviderModel(name);
  if (provider === "openai") {
    const key = getOpenAIKey();
    return key ? new OpenAIProvider({ apiKey: key.apiKey, model }) : null;
  }
  if (provider === "gemini") {
    // Stub belum aktif: generate() melempar → orchestrator catch → template.
    return new GeminiProvider();
  }
  // default: anthropic / claude
  const key = getAnthropicKey();
  return key ? new ClaudeProvider({ apiKey: key.apiKey, model }) : null;
}

// Produksi: provider aktif berdasarkan AI_REPLY_PROVIDER (default claude).
export function getActiveProvider() {
  return buildProvider(replyProviderName());
}

export { ClaudeProvider } from "./ClaudeProvider.js";
export { OpenAIProvider } from "./OpenAIProvider.js";
export { GeminiProvider } from "./GeminiProvider.js";
export { LLMProvider } from "./LLMProvider.js";
