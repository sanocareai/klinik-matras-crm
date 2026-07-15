// ─── WAVE 4B.0 — CLAUDE PROVIDER (AKTIF) ────────────────────────────────────
// Membungkus transport yang sudah ada (services/providers/anthropicProvider.js).
// TIDAK menyentuh WAHA/inbox — murni panggil Anthropic Messages API.
import { LLMProvider } from "./LLMProvider.js";
import * as anthropic from "../../providers/anthropicProvider.js";

export class ClaudeProvider extends LLMProvider {
  constructor({ apiKey, model }) {
    super();
    this.apiKey = apiKey;
    this.model = model;
  }

  get name() {
    return "claude";
  }

  async generate({ systemPrompt, userPrompt, maxTokens = 350 }) {
    const { reply, usage } = await anthropic.chat({
      apiKey: this.apiKey,
      model: this.model,
      systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
      maxTokens,
    });
    return { text: reply, usage };
  }
}
