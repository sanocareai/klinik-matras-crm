// ─────────────────────────────────────────────────────────────────────────────
// handoverDetector.js — Fase C Klinik Matras AI
// Deteksi buying signal + generator ringkasan handover untuk Sano AI Warming
//
// ⚠️  SANDBOX ONLY — belum tersambung ke WhatsApp nyata.
//     Dipakai di AI Playground untuk simulasi & validasi sebelum Fase F.
//
// CARA TEST — 5 SKENARIO UTAMA (jalankan di AI Playground > tab AI):
//
//  Skenario 1 — Trigger harga spesifik
//    Mulai percakapan biasa → lalu ketik: "berapa harga upgrade fondasi?"
//    Ekspektasi: muncul card SIMULASI dengan trigger HARGA_SPESIFIK
//
//  Skenario 2 — Komplain PRIORITAS TINGGI
//    Ketik: "kasur yang kemarin diupgrade makin sakit pinggang, kecewa banget"
//    Ekspektasi: handover LANGSUNG, badge merah PRIORITAS TINGGI
//
//  Skenario 3 — Safety net (8+ balasan tanpa sinyal)
//    Chat santai soal tidur tanpa tanya harga/order/foto (lebih dari 8 balasan AI)
//    Ekspektasi: setelah ≥8 balasan, muncul card SAFETY_NET
//
//  Skenario 4 — Minta foto produk
//    Ketik: "bisa kirim foto-foto produknya kak?"
//    Ekspektasi: muncul card MINTA_FOTO
//
//  Skenario 5 — Negatif (jangan false-positive)
//    Ketik: "saya sering pegal bangun tidur, normal ga ya?"
//    Ekspektasi: TIDAK ada handover card — percakapan masih konsultasi biasa
// ─────────────────────────────────────────────────────────────────────────────

const CATEGORY_LABELS = {
  KOMPLAIN:       "Komplain / ketidakpuasan pelanggan",
  HARGA_SPESIFIK: "Tanya harga nominal spesifik",
  CARA_ORDER:     "Tanya cara order / pembayaran / pengiriman",
  MINTA_FOTO:     "Minta foto produk / katalog",
  MINTA_MANUSIA:  "Minta ngobrol orang asli / ditelepon",
  SAFETY_NET:     "Safety net (8+ balasan tanpa closing signal)",
};

const VALID_CATEGORIES = [
  "KOMPLAIN", "HARGA_SPESIFIK", "CARA_ORDER", "MINTA_FOTO", "MINTA_MANUSIA",
];

// Helper: panggil Claude API dengan 1 turn
async function callClaude(apiKey, modelId, systemPrompt, userContent, maxTokens) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: modelId,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Claude API error");
  return data.content[0]?.text || "";
}

// ─── detectHandoverSignal ────────────────────────────────────────────────────
// Analisis percakapan → kembalikan apakah harus handover + alasannya
//
// @param messages  Array [{role: "user"|"assistant", content: string}]
// @param apiKey    Kunci Anthropic yang sudah didekripsi
// @param modelId   ID model Claude (misal "claude-sonnet-4-6")
// @returns { shouldHandover: boolean, reason?, reasonLabel?, priority? }
export async function detectHandoverSignal(messages, apiKey, modelId) {
  // Hitung balasan AI untuk SAFETY_NET
  const assistantCount = messages.filter((m) => m.role === "assistant").length;

  // Harus ada setidaknya satu pesan dari customer
  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUserMsg) return { shouldHandover: false };

  // Buat konteks (maks 8 pesan terakhir, bersihkan role system)
  const context = messages
    .slice(-8)
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => `${m.role === "user" ? "Customer" : "Sano"}: ${m.content}`)
    .join("\n");

  const classifierSystem =
    `Kamu adalah sistem klasifikasi untuk customer service klinik kasur Indonesia. ` +
    `Analisis pesan TERAKHIR dari Customer dalam konteks percakapan. ` +
    `Tentukan apakah pesan itu menunjukkan sinyal bahwa percakapan harus diserahkan ke sales manusia.\n\n` +
    `Kategori yang tersedia:\n` +
    `- KOMPLAIN: ada nada marah, kecewa, atau komplain tentang produk/layanan\n` +
    `- HARGA_SPESIFIK: customer menanyakan harga nominal (berapa harganya, ada promo, diskon, dll)\n` +
    `- CARA_ORDER: customer tanya cara beli/order/DP/pembayaran/pengiriman\n` +
    `- MINTA_FOTO: customer minta foto produk, katalog, atau gambar kasur\n` +
    `- MINTA_MANUSIA: customer minta bicara orang asli, minta ditelepon, minta disambungkan ke tim\n` +
    `- TIDAK_ADA: percakapan masih tahap konsultasi/informasi, belum ada sinyal handover\n\n` +
    `Jawab HANYA dengan satu kata dari kategori di atas. Tidak ada kalimat lain.`;

  let category = "TIDAK_ADA";
  try {
    const responseText = await callClaude(
      apiKey, modelId, classifierSystem,
      `Konteks percakapan:\n${context}\n\nKlasifikasikan pesan TERAKHIR dari Customer di atas.`,
      20
    );
    const upper = responseText.trim().toUpperCase();
    category = VALID_CATEGORIES.find((c) => upper.includes(c)) || "TIDAK_ADA";
  } catch {
    // Kalau classifier error, fallthrough ke safety net check saja
  }

  // Safety net: kalau belum ada sinyal eksplisit tapi sudah ≥8 balasan AI
  const effectiveCategory =
    category === "TIDAK_ADA" && assistantCount >= 8 ? "SAFETY_NET" : category;

  if (effectiveCategory === "TIDAK_ADA") {
    return { shouldHandover: false };
  }

  return {
    shouldHandover: true,
    reason: effectiveCategory,
    reasonLabel: CATEGORY_LABELS[effectiveCategory] || effectiveCategory,
    priority: effectiveCategory === "KOMPLAIN" ? "tinggi" : "normal",
  };
}

// ─── generateHandoverSummary ─────────────────────────────────────────────────
// Generate ringkasan terstruktur percakapan untuk sales yang mengambil alih
//
// @param messages    Array pesan percakapan
// @param reason      Kategori trigger (misal "HARGA_SPESIFIK")
// @param priority    "tinggi" atau "normal"
// @param apiKey      Kunci Anthropic
// @param modelId     ID model Claude
// @returns string — ringkasan terformat siap tampil
export async function generateHandoverSummary(messages, reason, priority, apiKey, modelId) {
  const transcript = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => `${m.role === "user" ? "Customer" : "Sano"}: ${m.content}`)
    .join("\n\n");

  const priorityLine = priority === "tinggi"
    ? "🚨 PRIORITAS: KOMPLAIN — segera hubungi"
    : "";
  const reasonLabel = CATEGORY_LABELS[reason] || reason;

  const summarySystem =
    `Kamu adalah sistem ringkasan handover untuk tim sales Klinik Matras. ` +
    `Buat ringkasan singkat percakapan agar sales yang mengambil alih bisa memahami konteks TANPA membaca riwayat lengkap. ` +
    `Ekstrak HANYA informasi yang BENAR-BENAR disebutkan di percakapan — jangan mengarang. ` +
    `Kalau info tidak ada, tulis "tidak disebutkan".\n\n` +
    `Gunakan format PERSIS ini:\n` +
    `🔔 Handover dari Sano\n` +
    `${priorityLine ? priorityLine + "\n" : ""}` +
    `Pelanggan: tidak dikenal (mode simulasi Playground)\n` +
    `Keluhan: [keluhan tidur atau komplain yang disampaikan]\n` +
    `Berat badan: [angka jika disebutkan, atau "tidak disebutkan"]\n` +
    `Kebutuhan: [ukuran kasur, untuk siapa, atau "tidak disebutkan"]\n` +
    `Arah rekomendasi yang sudah dibahas: [jenis layanan/konsep, atau "belum sampai tahap ini"]\n` +
    `Trigger handover: ${reasonLabel}`;

  try {
    return await callClaude(
      apiKey, modelId, summarySystem,
      `Ringkum percakapan berikut:\n\n${transcript}`,
      400
    );
  } catch {
    // Fallback minimal kalau summary API gagal
    return (
      `🔔 Handover dari Sano\n` +
      `${priorityLine ? priorityLine + "\n" : ""}` +
      `Pelanggan: tidak dikenal (mode simulasi Playground)\n` +
      `Trigger handover: ${reasonLabel}\n` +
      `(Ringkasan otomatis gagal — cek API key / koneksi)`
    );
  }
}
