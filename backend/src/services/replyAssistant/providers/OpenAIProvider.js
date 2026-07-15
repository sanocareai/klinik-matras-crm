// ─── WAVE 4B.0.4 — OPENAI PROVIDER ──────────────────────────────────────────
// Membungkus transport yang SUDAH ADA (services/providers/openaiProvider.js,
// official OpenAI SDK). Kontrak input/output SAMA PERSIS dengan ClaudeProvider.
// TIDAK menyentuh WAHA/inbox — murni panggil OpenAI Chat Completions.
import { LLMProvider } from "./LLMProvider.js";
import * as openai from "../../providers/openaiProvider.js";

export class OpenAIProvider extends LLMProvider {
  constructor({ apiKey, model }) {
    super();
    this.apiKey = apiKey;
    this.model = model;
  }

  get name() {
    return "openai";
  }

  async generate({ systemPrompt, userPrompt, maxTokens = 350 }) {
    const { reply, usage } = await openai.chat({
      apiKey: this.apiKey,
      model: this.model,
      systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
      maxTokens,
    });
    return { text: reply, usage };
  }
}
