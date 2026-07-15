// ─── WAVE 4B.0 — GEMINI PROVIDER (PLACEHOLDER, BELUM AKTIF) ──────────────────
// Stub untuk membuktikan seam abstraksi. TIDAK dipakai/di-route di 4B.0.
// Wave berikut yang mengaktifkan fallback multi-provider.
import { LLMProvider } from "./LLMProvider.js";

export class GeminiProvider extends LLMProvider {
  get name() {
    return "gemini";
  }

  async generate() {
    throw new Error("GeminiProvider belum diaktifkan di Wave 4B (placeholder).");
  }
}
