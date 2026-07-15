// ─── WAVE 4B.0 — LLM PROVIDER (INTERFACE) ───────────────────────────────────
// Abstraksi minimal supaya wave berikut bisa menambah provider/routing TANPA
// mengubah orchestrator. 4B.0 hanya ClaudeProvider yang aktif.
export class LLMProvider {
  get name() {
    return "base";
  }

  // generate({ systemPrompt, userPrompt, maxTokens }) → { text, usage }
  // usage = { inputTokens, outputTokens, cacheReadTokens, cacheCreateTokens }
  async generate() {
    throw new Error("LLMProvider.generate() belum diimplementasi");
  }
}
