// ─── WAVE 4B.0 — PEMILIHAN PROVIDER (TANPA ROUTING) ─────────────────────────
// 4B.0: hanya Claude (Haiku) yang aktif. Kalau tidak ada API key → null
// (orchestrator fallback ke template). BELUM ada routing multi-provider.
import { ClaudeProvider } from "./ClaudeProvider.js";
import { getAnthropicKey } from "./keyStore.js";
import { REPLY_MODEL } from "../config.js";

export function getActiveProvider() {
  const key = getAnthropicKey();
  if (!key) return null;
  return new ClaudeProvider({ apiKey: key.apiKey, model: REPLY_MODEL });
}

export { ClaudeProvider } from "./ClaudeProvider.js";
export { GeminiProvider } from "./GeminiProvider.js";
export { LLMProvider } from "./LLMProvider.js";
