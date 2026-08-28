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

  // AI Conversation Quality Scorer (26 Agustus 2026) — job harian, batch
  // kecil (sample_size x jumlah sales aktif, lihat config/qualityScorer
  // Rubric.js). Haiku dipilih (bukan Sonnet) atas keputusan owner: cukup
  // murah utk sampling harian, dan rubrik grading tidak butuh reasoning
  // sedalam percakapan customer langsung.
  SANO_QUALITY_SCORER: "claude-haiku-4-5-20251001",

  // akuiPresent/galiPresent SAJA (28 Agustus 2026) — SCOPE KETAT, BUKAN
  // default Quality Scorer di atas. 4 iterasi prompt di Haiku (1 gabungan +
  // 2-panggilan terstruktur, dgn/tanpa jangkar) TERBUKTI TIDAK STABIL utk
  // membedakan validasi empati spesifik dari basa-basi generik — root cause
  // kapabilitas model, bukan lagi wording prompt (diverifikasi live thd 3
  // transkrip yang sama, semua percobaan Haiku gagal identik). Sonnet
  // dipakai HANYA di grading.js#extractAkuiGali — SEMUA dimensi/panggilan
  // lain (communicationSkill/authoritySelling/evidenceBasedSelling, DAN
  // score/quote/strength/weakness/objectionType-nya objectionHandling
  // sendiri) TETAP Haiku (SANO_QUALITY_SCORER di atas), TIDAK berubah.
  SANO_QUALITY_SCORER_AKUI_GALI: "claude-sonnet-4-6",
};
