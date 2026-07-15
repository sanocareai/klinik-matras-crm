// Model AI per fitur — ubah di sini kalau mau ganti model, tidak perlu cari di banyak tempat

export const AI_MODELS = {
  // Customer-facing: Sano Chatbot (AI Playground / nanti production)
  // Pakai Sonnet untuk kualitas jawaban terbaik — customer langsung baca hasilnya
  SANO_CHATBOT: "claude-haiku-4-5-20251001",

  // Internal: Sano Co-pilot untuk sales
  // Haiku cukup akurat untuk pertanyaan internal + 3x lebih murah dari Sonnet
  SANO_COPILOT: "claude-haiku-4-5-20251001",

  // Wave 4B: Reply Assistant (draf balasan internal). Haiku — murah, cukup akurat,
  // Bahasa Indonesia bagus. Single-model (belum ada routing).
  SANO_REPLY_ASSISTANT: "claude-haiku-4-5-20251001",

  // Wave 4B.0.4 — Multi-LLM. Config = SUMBER KEBENARAN model per provider.
  // Env OPENAI_REPLY_MODEL bisa override model OpenAI (escape hatch tanpa ubah kode).
  // Pemilihan provider via env AI_REPLY_PROVIDER (default claude). BUKAN routing otomatis.
  SANO_REPLY_ASSISTANT_CLAUDE: { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
  SANO_REPLY_ASSISTANT_OPENAI: { provider: "openai", model: "gpt-4.1-mini" },
};
