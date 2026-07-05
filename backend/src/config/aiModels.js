// Model AI per fitur — ubah di sini kalau mau ganti model, tidak perlu cari di banyak tempat

export const AI_MODELS = {
  // Customer-facing: Sano Chatbot (AI Playground / nanti production)
  // Pakai Sonnet untuk kualitas jawaban terbaik — customer langsung baca hasilnya
  SANO_CHATBOT: "claude-sonnet-4-6",

  // Internal: Sano Co-pilot untuk sales
  // Haiku cukup akurat untuk pertanyaan internal + 3x lebih murah dari Sonnet
  SANO_COPILOT: "claude-haiku-4-5-20251001",
};
