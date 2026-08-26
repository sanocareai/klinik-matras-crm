// ═══ RUBRIK & KONFIGURASI — AI CONVERSATION QUALITY SCORER ═══════════════
// Rubrik dan ambang konfigurasi SENGAJA dipisah dari logic job/grading
// (services/qualityScorer/*.js) — isinya akan berkembang (bobot dinilai
// ulang, kalimat rubrik diperhalus, sumber pengetahuan ditambah) dan tidak
// boleh butuh sentuh kode logic tiap kali itu terjadi.
//
// PELENGKAP audit_balasan_sales (mcp/toolsChat.js, rule-based/regex) —
// JANGAN diduplikasi/diganti. Itu menilai PELANGGARAN (garansi flat, klaim
// medis, dst), ini menilai SUBSTANSI/KUALITAS POSITIF lewat LLM.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { AI_MODELS } from "./aiModels.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// backend/src/config/ → naik 3 tingkat ke root repo, docs/ ada di sana
// (sibling dari backend/), BUKAN di dalam backend/. Sama pola dengan
// routes/ai.js yang resolve backend/data/knowledge relatif ke __dirname.
const REPO_ROOT = path.join(__dirname, "../../..");
const KB_DIR = path.join(REPO_ROOT, "docs", "knowledge_base");

export const QUALITY_SCORER_MODEL = AI_MODELS.SANO_QUALITY_SCORER;

// Configurable lewat env, BUKAN hardcode — sesuai permintaan owner. Default
// dipilih owner: 5 percakapan/sales/hari.
export const SAMPLE_SIZE_PER_SALES = Math.max(1, parseInt(process.env.QUALITY_SCORER_SAMPLE_SIZE, 10) || 5);

// Jaring pengaman biaya TERPISAH dari sample_size x jumlah_sales — kalau
// suatu saat jumlah sales aktif membengkak jauh dari perkiraan sekarang
// (8 sales, lihat CLAUDE.md §1), total panggilan LLM harian TETAP dibatasi
// keras di sini, bukan cuma "berharap" hasil kali dua angka lain tetap kecil.
export const MAX_DAILY_LLM_CALLS = Math.max(1, parseInt(process.env.QUALITY_SCORER_MAX_DAILY_CALLS, 10) || 100);

// Prioritas sampling: PipelineStage yang lebih "matang" (sudah lewat NEW)
// didahulukan — percakapan di stage ini lebih mungkin punya substansi
// (pembahasan produk, keberatan, dst) utk dinilai 4 dimensi, dibanding
// NEW yang seringkali baru sapaan awal. SPAM SELALU dikecualikan (bukan
// bagian prioritas terendah — dikecualikan TOTAL dari sampling, sama
// alasannya dgn exclude SPAM dari Closing Rate di /sales-report).
//
// CATATAN TERJEMAHAN (26 Agustus 2026): permintaan awal menyebut stage
// "QUALIFIED/QUOTED/BOOKED" — nama itu SUDAH TIDAK ADA di skema saat ini
// (restrukturisasi 24-26 Agustus 2026 menggabungnya jadi PROSPECT/
// TRANSACTION/REVIEWED, lihat backend/prisma/schema.prisma). Urutan di
// bawah adalah padanan yang dikonfirmasi owner.
export const STAGE_PRIORITY = ["PROSPECT", "TRANSACTION", "REVIEWED", "NEW"];
export const EXCLUDED_STAGE = "SPAM";

// ── 4 dimensi rubrik ──────────────────────────────────────────────────────
// `scoringGuide` dipakai APA ADANYA di prompt LLM (lihat buildSystemPrompt
// di bawah) — edit di sini kalau kalimatnya perlu diperhalus, tidak perlu
// sentuh services/qualityScorer/grading.js.
export const RUBRIC_DIMENSIONS = [
  {
    key: "productKnowledge",
    label: "Product Knowledge Accuracy",
    description: "Seberapa akurat & mendalam sales menjelaskan produk/layanan Klinik Matras (fondasi, lapisan, material, harga, garansi) dibanding referensi pengetahuan yang diberikan.",
    scoringGuide: {
      1: "Ada klaim yang SALAH/menyimpang dari referensi (mis. keliru soal cara kerja fondasi/lapisan, garansi, atau harga), atau pertanyaan produk customer tidak dijawab sama sekali.",
      2: "Jawaban tidak salah tapi dangkal/generik ('kasur kami bagus kok') — tidak menunjukkan pemahaman produk yang nyata.",
      3: "Jawaban benar & relevan, tapi minim detail teknis (istilah/spesifikasi) yang sebetulnya bisa dipakai untuk membangun kredibilitas.",
      4: "Akurat, memakai istilah teknis yang tepat (mis. Pocket Spring/density/HR Foam) DENGAN penjelasan awam yang jelas dalam kalimat yang sama.",
      5: "Sama seperti 4, DAN dikaitkan langsung ke kebutuhan spesifik customer itu (bukan penjelasan generik yang bisa dipakai ke siapa saja).",
    },
  },
  {
    key: "consultationProcess",
    label: "Proses Konsultasi",
    description: "Apakah sales mendiagnosa kebutuhan customer dulu (siapa pemakai, keluhan tidur, berat badan, kebutuhan ukuran) sebelum merekomendasikan, mengikuti pola konsultan (bukan langsung jualan).",
    scoringGuide: {
      1: "Langsung ke rekomendasi/closing/harga tanpa diagnosa apa pun (tidak tanya keluhan, berat badan, atau kebutuhan).",
      2: "Ada sebagian diagnosa, tapi terasa terburu-buru atau seperti interogasi (bukan mengalir natural).",
      3: "Diagnosa dasar lengkap (keluhan + kebutuhan) tapi rekomendasi yang diberikan tidak jelas dikaitkan balik ke hasil diagnosa itu.",
      4: "Alur natural: gali kebutuhan → edukasi singkat → rekomendasi yang jelas nyambung ke jawaban customer sebelumnya.",
      5: "Sama seperti 4, ditambah personalisasi kuat — rekomendasi terasa dibuat khusus untuk situasi customer ini, bukan template yang bisa dipakai ke siapa saja.",
    },
  },
  {
    key: "healthImpact",
    label: "Penjelasan Dampak Kesehatan",
    description: "Apakah sales menjelaskan KENAPA kasur/upgrade yang direkomendasikan relevan untuk kesehatan tidur & tubuh customer (bukan cuma jual fitur), sesuai konsep Matras Sehat.",
    scoringGuide: {
      1: "Tidak pernah mengaitkan produk ke dampak kesehatan/tidur sama sekali sepanjang percakapan.",
      2: "Menyebut kata 'sehat'/'nyaman' tapi tanpa penjelasan MENGAPA (klaim kosong, tidak ada mekanisme yang dijelaskan).",
      3: "Menjelaskan dampak kesehatan secara umum (mis. 'bagus buat tulang belakang') tapi tidak dikaitkan ke keluhan spesifik customer.",
      4: "Mengaitkan mekanisme (fondasi/lapisan/tekanan/berat badan) ke KELUHAN SPESIFIK customer dengan benar sesuai referensi pengetahuan.",
      5: "Sama seperti 4, dijelaskan dengan bahasa awam yang mudah dipahami TAPI tetap akurat secara teknis — gaya 'klinis tapi hangat' yang jadi ciri khas brand.",
    },
  },
  {
    key: "objectionHandling",
    label: "Objection Handling",
    description: "Kalau customer menunjukkan keberatan/keraguan (harga, ragu efektivitas, bandingkan kompetitor, dll), bagaimana sales meresponnya. Kalau TIDAK ADA keberatan sama sekali di percakapan ini, kembalikan skor null (jangan dipaksa menilai sesuatu yang tidak terjadi).",
    scoringGuide: {
      1: "Keberatan customer diabaikan, atau dijawab defensif/tidak sabar.",
      2: "Dijawab, tapi generik/template — tidak benar-benar menjawab kekhawatiran spesifik yang diutarakan.",
      3: "Keberatan diakui & dijawab relevan, tapi tanpa bukti/penjelasan pendukung (mis. tidak menyebut garansi/trial/data teknis).",
      4: "Keberatan diakui, dijawab dengan penjelasan/bukti konkret (garansi, trial kenyamanan, data teknis) yang relevan dengan keberatannya.",
      5: "Sama seperti 4, DAN dilakukan dengan empati — customer terasa didengar, bukan dilawan atau didesak.",
    },
  },
];

// ── Referensi pengetahuan produk & kesehatan (docs/knowledge_base/) ───────
// Konten INI TIDAK DIKARANG oleh Claude Code — file-file sumbernya disiapkan
// & diisi langsung oleh tim Sano di docs/knowledge_base/. Kalau daftar file
// di bawah perlu ditambah/dikurangi, edit di sini saja.
const KB_FILES = [
  { file: "01-konsep-matras-sehat.md", label: "Konsep Matras Sehat" },
  { file: "02-harga-layanan.md", label: "Katalog Layanan & Harga" },
  { file: "02-SANO_Ensiklopedia_Dunia_Kasur - Skill.md", label: "Ensiklopedia Dunia Kasur" },
  { file: "03-sano-faq.md", label: "FAQ Pelanggan" },
];

// Dibaca APA ADANYA (tanpa truncation agresif seperti buildKbContext di
// routes/ai.js) — job ini jalan sedikit kali/hari (bukan tiap pesan chat
// customer), dan system prompt-nya di-cache Anthropic (ephemeral, lihat
// services/providers/anthropicProvider.js) jadi biaya konten besar ini
// cuma dibayar PENUH sekali per batch harian, bukan per panggilan.
export function loadKnowledgeContext() {
  const parts = [];
  const missing = [];
  for (const { file, label } of KB_FILES) {
    const fp = path.join(KB_DIR, file);
    try {
      const text = fs.readFileSync(fp, "utf-8").trim();
      if (text) parts.push(`--- ${label} (${file}) ---\n${text}`);
    } catch {
      missing.push(file);
    }
  }
  return { context: parts.join("\n\n"), missing };
}

function formatScoringGuide(guide) {
  return Object.entries(guide).map(([n, desc]) => `  ${n} = ${desc}`).join("\n");
}

// Prompt sistem lengkap: instruksi + rubrik + referensi pengetahuan.
// Ditaruh di `system` (bukan user message) supaya kena prompt caching
// Anthropic — bagian ini SAMA untuk semua percakapan dalam satu batch job,
// cuma transcript per-panggilan yang beda (lihat grading.js).
export function buildSystemPrompt() {
  const { context: kbContext, missing } = loadKnowledgeContext();
  const rubricText = RUBRIC_DIMENSIONS.map((d) =>
    `### ${d.label} (kunci JSON: "${d.key}")\n${d.description}\n\nPanduan skor 1-5:\n${formatScoringGuide(d.scoringGuide)}`
  ).join("\n\n");

  return `Kamu adalah supervisor kualitas percakapan sales di Klinik Matras (Sano Care), sebuah klinik restorasi kasur ("Ahlinya Kasur Sehat"). Tugasmu MENILAI (bukan membalas) transkrip percakapan WhatsApp antara seorang SALES dan seorang CUSTOMER, berdasarkan 4 dimensi rubrik di bawah.

ATURAN PENTING:
- Nilai HANYA berdasarkan apa yang benar-benar ada di transkrip. JANGAN menebak/mengarang hal yang tidak disebutkan.
- Kalau topik satu dimensi TIDAK PERNAH muncul di percakapan ini (mis. tidak ada keberatan sama sekali untuk "objectionHandling", atau percakapan terlalu singkat untuk membahas dampak kesehatan), kembalikan score: null untuk dimensi itu dan jelaskan singkat di note kenapa null — JANGAN memaksa angka 1-5 untuk sesuatu yang tidak terjadi.
- "quote" adalah kutipan LANGSUNG (1-2 kalimat) dari pesan SALES yang jadi bukti utama skor itu — kutip persis, jangan parafrase. null kalau skornya juga null.
- "note" adalah SATU baris catatan coaching (bahasa Indonesia, actionable, maksimal ~25 kata) — apa yang sudah bagus ATAU apa yang perlu diperbaiki sales ini ke depan.
- Fokus HANYA pada pesan dari SALES (OUTBOUND). Pesan customer (INBOUND) dipakai sebagai KONTEKS untuk menilai respons sales, bukan dinilai sendiri.
- Ini PELENGKAP sistem deteksi pelanggaran yang sudah ada secara terpisah (klaim garansi salah, janji medis, dst) — JANGAN ulang menilai pelanggaran compliance di sini, fokus ke SUBSTANSI/KUALITAS percakapan.

RUBRIK PENILAIAN:

${rubricText}

REFERENSI PENGETAHUAN PRODUK & KESEHATAN (dipakai untuk menilai akurasi di dimensi Product Knowledge Accuracy & Penjelasan Dampak Kesehatan — SALES tidak wajib menyebut semua ini, tapi apa yang DIA sebutkan harus konsisten dengan referensi ini):

${kbContext || "(Tidak ada referensi termuat — nilai product knowledge/dampak kesehatan berdasarkan kewajaran umum saja, tandai overallNote bahwa referensi tidak tersedia.)"}

FORMAT OUTPUT — WAJIB JSON valid, TANPA teks lain di luar JSON, dengan struktur PERSIS ini:
{
  "productKnowledge": { "score": 1-5 atau null, "quote": "..." atau null, "note": "..." },
  "consultationProcess": { "score": 1-5 atau null, "quote": "..." atau null, "note": "..." },
  "healthImpact": { "score": 1-5 atau null, "quote": "..." atau null, "note": "..." },
  "objectionHandling": { "score": 1-5 atau null, "quote": "..." atau null, "note": "..." },
  "overallNote": "satu kalimat ringkasan coaching keseluruhan percakapan ini"
}${missing.length ? `\n\n(Catatan internal — file referensi berikut tidak ditemukan saat prompt ini dibuat: ${missing.join(", ")})` : ""}`;
}
