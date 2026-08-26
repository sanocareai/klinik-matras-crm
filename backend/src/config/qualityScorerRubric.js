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
// naik dari 5 → 12 percakapan/sales/hari (26 Agustus 2026), setelah validasi
// manual selesai (fix ekstraksi flag + backfill 12 baris terverifikasi bersih).
export const SAMPLE_SIZE_PER_SALES = Math.max(1, parseInt(process.env.QUALITY_SCORER_SAMPLE_SIZE, 10) || 12);

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
  // ── Dimensi E & F (26 Agustus 2026) — pattern aggregation ────────────────
  // Beda dari 4 dimensi di atas: masing-masing punya `flag` (kunci JSON
  // boolean + pertanyaan tegas). Flag inilah yang membuat rollup mingguan
  // bisa hitung pola berulang ("% percakapan tanpa closing ask minggu ini")
  // lewat query database biasa, TANPA panggil LLM lagi. Kehadiran `flag`
  // pada objek dimensi jugalah yang membedakan dimensi ini sebagai
  // "PATTERN_DIMENSIONS" di bawah — lihat CORE_DIMENSIONS/PATTERN_DIMENSIONS.
  {
    key: "closingAssertiveness",
    label: "Closing Assertiveness",
    description: "Apakah sales secara AKTIF mendorong customer ke komitmen/next step konkret (jadwal survei/pengukuran, tawarkan booking, ciptakan urgensi wajar) SETELAH presentasi harga/paket — bukan cuma menyampaikan info lalu menunggu customer follow-up sendiri. Kalau presentasi harga/paket TIDAK PERNAH terjadi di percakapan ini, kembalikan skor null (belum ada momen closing untuk dinilai).",
    scoringGuide: {
      1: "Presentasi harga/paket sudah terjadi tapi sales TIDAK meminta next step apa pun — percakapan menggantung, customer dibiarkan mikir sendiri tanpa dorongan.",
      2: "Ada dorongan tapi sangat pasif/generik ('kalau berminat kabari ya') — tidak ada ajakan konkret (jadwal/booking) atau urgensi.",
      3: "Ada ajakan next step konkret (mis. tawarkan jadwal), tapi disampaikan ragu-ragu atau cuma sekali tanpa follow-through kalau customer diam.",
      4: "Meminta komitmen/next step konkret dengan percaya diri (tawarkan jadwal/booking spesifik, atau urgensi yang wajar & jujur — bukan tekanan palsu).",
      5: "Sama seperti 4, DAN disesuaikan dengan sinyal minat customer (tidak maksa kalau customer masih ragu, tapi tetap proaktif menutup celah dengan next step jelas).",
    },
    flag: {
      key: "closingAskPresent",
      question: "Apakah SETELAH presentasi harga/paket, sales secara eksplisit meminta komitmen atau menawarkan next step konkret (jadwal, booking, dsb)?",
    },
  },
  {
    key: "customerComprehension",
    label: "Customer Comprehension",
    description: "Apakah sales menyesuaikan bahasa ke level pemahaman customer (menerjemahkan istilah teknis, bukan jargon murni tanpa penyederhanaan) dan AKTIF mengecek pemahaman customer (mis. 'sejauh ini jelas kak?', menanyakan ulang dgn kata lain) — bukan cuma menyampaikan info satu arah. Kalau percakapan terlalu singkat/dangkal untuk menilai gaya komunikasi sales (mis. cuma 1-2 balasan basa-basi), kembalikan skor null.",
    scoringGuide: {
      1: "Jargon teknis dipakai tanpa penjelasan sama sekali, ATAU sales tidak pernah mengecek apakah customer paham — murni satu arah.",
      2: "Sesekali menjelaskan istilah, tapi mayoritas penjelasan masih terasa teknis/sulit diikuti orang awam.",
      3: "Bahasa cukup mudah dipahami, tapi tidak ada usaha aktif mengecek pemahaman customer di sepanjang percakapan.",
      4: "Bahasa disederhanakan dengan baik DAN minimal sekali mengecek pemahaman customer secara eksplisit.",
      5: "Sama seperti 4, dilakukan konsisten sepanjang percakapan — tiap penjelasan penting diikuti pengecekan pemahaman, dan disesuaikan lagi kalau customer terlihat bingung.",
    },
    flag: {
      key: "plainLanguageUsed",
      question: "Apakah sales menggunakan bahasa yang disederhanakan (bukan jargon murni) DAN aktif mengecek pemahaman customer minimal sekali?",
    },
  },
];

// 4 dimensi asli (Fase 1) — TIDAK punya `flag`, logika/skornya TIDAK diubah
// oleh penambahan dimensi E & F. Dipakai rollup.js utk overall/avg lama
// supaya section dashboard existing tetap identik.
export const CORE_DIMENSIONS = RUBRIC_DIMENSIONS.filter((d) => !d.flag);
// Dimensi E & F — dipakai rollup.js utk pattern aggregation (frekuensi flag
// negatif, tren per dimensi) & weeklyNarrative.js utk ringkasan naratif.
export const PATTERN_DIMENSIONS = RUBRIC_DIMENSIONS.filter((d) => d.flag);

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

// Blok rubrik satu dimensi. Utk dimensi ber-flag (lihat PATTERN_DIMENSIONS),
// tambahkan baris instruksi flag di bawah scoring guide — dimensi TANPA
// flag (4 dimensi asli) hasilnya PERSIS sama seperti sebelum dimensi E/F
// ditambahkan (tidak ada baris tambahan apa pun).
function formatDimensionBlock(d) {
  const flagLine = d.flag
    ? `\n\nFlag boolean WAJIB (kunci JSON: "${d.flag.key}"): ${d.flag.question} Jawab true/false tegas kalau score dimensi ini terisi; kembalikan null HANYA kalau score-nya juga null. PENTING — LOKASI: "${d.flag.key}" harus jadi key DI DALAM objek "${d.key}" ini (sejajar dengan "score"/"quote"/"note"), BUKAN key terpisah di level atas/root JSON.`
    : "";
  return `### ${d.label} (kunci JSON: "${d.key}")\n${d.description}\n\nPanduan skor 1-5:\n${formatScoringGuide(d.scoringGuide)}${flagLine}`;
}

// Baris spesifikasi JSON satu dimensi utk bagian FORMAT OUTPUT di bawah.
// Dimensi tanpa flag menghasilkan bentuk {"score":...,"quote":...,"note":...}
// — IDENTIK dgn format sebelum dimensi E/F ditambahkan.
function formatOutputFieldSpec(d) {
  const flagPart = d.flag ? `, "${d.flag.key}": true/false atau null` : "";
  return `  "${d.key}": { "score": 1-5 atau null, "quote": "..." atau null, "note": "..."${flagPart} }`;
}

// Prompt sistem lengkap: instruksi + rubrik + referensi pengetahuan.
// Ditaruh di `system` (bukan user message) supaya kena prompt caching
// Anthropic — bagian ini SAMA untuk semua percakapan dalam satu batch job,
// cuma transcript per-panggilan yang beda (lihat grading.js).
export function buildSystemPrompt() {
  const { context: kbContext, missing } = loadKnowledgeContext();
  const rubricText = RUBRIC_DIMENSIONS.map(formatDimensionBlock).join("\n\n");
  const outputSpec = RUBRIC_DIMENSIONS.map(formatOutputFieldSpec).join(",\n");

  return `Kamu adalah supervisor kualitas percakapan sales di Klinik Matras (Sano Care), sebuah klinik restorasi kasur ("Ahlinya Kasur Sehat"). Tugasmu MENILAI (bukan membalas) transkrip percakapan WhatsApp antara seorang SALES dan seorang CUSTOMER, berdasarkan ${RUBRIC_DIMENSIONS.length} dimensi rubrik di bawah.

ATURAN PENTING:
- Nilai HANYA berdasarkan apa yang benar-benar ada di transkrip. JANGAN menebak/mengarang hal yang tidak disebutkan.
- Kalau topik satu dimensi TIDAK PERNAH muncul di percakapan ini (mis. tidak ada keberatan sama sekali untuk "objectionHandling", atau percakapan terlalu singkat untuk membahas dampak kesehatan), kembalikan score: null untuk dimensi itu dan jelaskan singkat di note kenapa null — JANGAN memaksa angka 1-5 untuk sesuatu yang tidak terjadi.
- "quote" adalah kutipan LANGSUNG (1-2 kalimat) dari pesan SALES yang jadi bukti utama skor itu — kutip persis, jangan parafrase. null kalau skornya juga null.
- "note" adalah SATU baris catatan coaching (bahasa Indonesia, actionable, maksimal ~25 kata) — apa yang sudah bagus ATAU apa yang perlu diperbaiki sales ini ke depan.
- Beberapa dimensi (lihat definisi di bawah) juga punya flag boolean WAJIB selain score — flag itu HARUS true/false tegas (bukan teks bebas) kalau score dimensi itu terisi, dan ikut null hanya kalau score-nya juga null. Flag itu WAJIB jadi key DI DALAM objek dimensinya sendiri (sejajar dengan score/quote/note) — JANGAN PERNAH ditaruh sebagai key terpisah di level atas/root JSON, sekalipun nama key-nya sudah unik.
- Fokus HANYA pada pesan dari SALES (OUTBOUND). Pesan customer (INBOUND) dipakai sebagai KONTEKS untuk menilai respons sales, bukan dinilai sendiri.
- Ini PELENGKAP sistem deteksi pelanggaran yang sudah ada secara terpisah (klaim garansi salah, janji medis, dst) — JANGAN ulang menilai pelanggaran compliance di sini, fokus ke SUBSTANSI/KUALITAS percakapan.

RUBRIK PENILAIAN:

${rubricText}

REFERENSI PENGETAHUAN PRODUK & KESEHATAN (dipakai untuk menilai akurasi di dimensi Product Knowledge Accuracy & Penjelasan Dampak Kesehatan — SALES tidak wajib menyebut semua ini, tapi apa yang DIA sebutkan harus konsisten dengan referensi ini):

${kbContext || "(Tidak ada referensi termuat — nilai product knowledge/dampak kesehatan berdasarkan kewajaran umum saja, tandai overallNote bahwa referensi tidak tersedia.)"}

FORMAT OUTPUT — WAJIB JSON valid, TANPA teks lain di luar JSON, dengan struktur PERSIS ini (PERHATIKAN: setiap flag boolean ada DI DALAM kurung kurawal objek dimensinya masing-masing, BUKAN key terpisah sejajar "overallNote" di root):
{
${outputSpec},
  "overallNote": "satu kalimat ringkasan coaching keseluruhan percakapan ini"
}${missing.length ? `\n\n(Catatan internal — file referensi berikut tidak ditemukan saat prompt ini dibuat: ${missing.join(", ")})` : ""}`;
}
