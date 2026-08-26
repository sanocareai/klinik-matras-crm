// ═══ RUBRIK & KONFIGURASI — AI CONVERSATION QUALITY SCORER ═══════════════
// Rubrik dan ambang konfigurasi SENGAJA dipisah dari logic job/grading
// (services/qualityScorer/*.js) — isinya akan berkembang dan tidak boleh
// butuh sentuh kode logic tiap kali itu terjadi.
//
// PELENGKAP audit_balasan_sales (mcp/toolsChat.js, rule-based/regex) —
// JANGAN diduplikasi/diganti. Itu menilai PELANGGARAN (garansi flat, klaim
// medis, dst), ini menilai SUBSTANSI/KUALITAS lewat LLM.
//
// RUBRIK DIGANTI TOTAL (27 Agustus 2026) — bukan lagi 6 dimensi generik yang
// ditulis berdasarkan penilaian umum, tapi 3 modul RESMI kurikulum SANO Care
// (docs/SANO_Sales_Framework/) yang sudah dipakai tim training sungguhan.
// Keputusan owner: satu sumber kebenaran evaluasi kualitas sales, bukan
// sistem paralel. Kolom DB dimensi lama (productKnowledge/consultationProcess/
// healthImpact/closingAssertiveness/customerComprehension) TIDAK dihapus di
// schema — riwayatnya tetap ada sbg data legacy, cuma tidak ditulis lagi.
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
const SALES_FRAMEWORK_DIR = path.join(REPO_ROOT, "docs", "SANO_Sales_Framework");

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
// (pembahasan produk, keberatan, dst) utk dinilai. SPAM SELALU dikecualikan.
export const STAGE_PRIORITY = ["PROSPECT", "TRANSACTION", "REVIEWED", "NEW"];
export const EXCLUDED_STAGE = "SPAM";

// ── 3 dimensi rubrik — PERSIS 3 modul SANO Care Sales Framework ───────────
// `scoringGuide` diturunkan LANGSUNG dari isi modul (alur/kesalahan yang
// disebut eksplisit di teksnya), bukan dikarang generik. Tidak ada `flag`
// di dimensi manapun kali ini (beda dari rubrik lama E/F) — CORE_DIMENSIONS
// jadi berisi ketiganya, PATTERN_DIMENSIONS kosong (lihat catatan di bawah).
export const RUBRIC_DIMENSIONS = [
  {
    key: "communicationSkill",
    label: "Communication Skill",
    description:
      "Modul 4 SANO Care: kemampuan konsultan menggali kebutuhan pelanggan lewat komunikasi, BUKAN sekadar menjelaskan produk. Alur wajib: Dengar → Bertanya → Memahami → Menganalisis → Edukasi → Solusi → Closing (closing di tahap TERAKHIR, bukan di awal). Evaluasi: active listening, pertanyaan penggalian (idealnya mengacu ke 8 pertanyaan inti: kondisi fisik kasur, keluhan tubuh, berat badan, lama keluhan, umur kasur, posisi tidur, riwayat kasur, pengalaman ternyaman), validasi jawaban pelanggan (\"baik Pak, saya catat\", \"berarti keluhannya di ... ya\"), dan alur percakapan secara keseluruhan.",
    scoringGuide: {
      1: "Langsung menawarkan produk/harga tanpa bertanya sama sekali, ATAU memotong/mengabaikan jawaban pelanggan, ATAU langsung membahas harga di awal.",
      2: "Ada pertanyaan tapi ditembakkan beruntun tanpa memberi ruang jawab, dan/atau tanpa validasi sama sekali terhadap jawaban pelanggan.",
      3: "Bertanya & mendengar dasar (mencakup sebagian dari 8 pertanyaan inti) tapi tanpa validasi eksplisit, dan tidak menggali lebih dalam dari jawaban pertama.",
      4: "Alur natural mengikuti formula Dengar→Bertanya→Memahami→Menganalisis→Edukasi→Solusi→Closing, ada validasi eksplisit, pertanyaan cukup menggali (tidak berhenti di jawaban pertama).",
      5: "Sama seperti 4, DAN closing baru muncul di tahap akhir (bukan didahulukan), edukasi terjalin natural dalam percakapan (bukan ceramah terpisah), istilah teknis (kalau dipakai) selalu diikuti penjelasan awam.",
    },
  },
  {
    key: "authoritySelling",
    label: "Authority Selling",
    description:
      "Modul 6 SANO Care: membangun kepercayaan lewat kompetensi & bukti, BUKAN promosi. Struktur wajib tiap rekomendasi: Data (rujuk hasil konsultasi) → Analisis → Penjelasan sebab-akibat → Bukti (evidence) → Rekomendasi → Closing. Evaluasi: apakah sales memakai data pelanggan SEBELUM merekomendasikan, menjelaskan mekanisme sebab-akibat, memakai bukti (foto/video/pengukuran/testimoni/story selling), MENGHINDARI klaim tanpa dukungan (\"pasti\", \"dijamin\", \"pasti sembuh\" — konsultan bukan dokter), dan memberi rekomendasi profesional (bukan \"harus beli ini\").",
    scoringGuide: {
      1: "Rekomendasi tanpa rujukan data sama sekali (\"kasur ini bagus Pak\"), ATAU memakai klaim pasti/dijamin/menyembuhkan, ATAU memberikan diagnosis medis.",
      2: "Ada sedikit rujukan ke jawaban pelanggan tapi rekomendasi tetap terasa generik/template, bisa dipakai ke siapa saja.",
      3: "Rekomendasi merujuk data pelanggan (\"berdasarkan yang Bapak sampaikan...\") tapi TANPA penjelasan sebab-akibat/mekanisme, dan tanpa bukti konkret.",
      4: "Ikuti struktur: rujuk hasil konsultasi → kesimpulan hati-hati (\"kemungkinan...\", BUKAN \"pasti\") → jelaskan mekanisme sebab-akibat dengan bahasa sederhana → hubungkan ke solusi.",
      5: "Sama seperti 4, DITAMBAH bukti konkret (foto/video/pengukuran/story selling pelanggan lain) yang memperkuat rekomendasi.",
    },
  },
  {
    key: "objectionHandling",
    label: "Objection Handling",
    description:
      "Modul 7 SANO Care: keberatan pelanggan adalah SINYAL MINAT, bukan penolakan — direspons dengan tenang, bukan dilawan. Framework wajib 5 langkah: Dengar → Akui → Gali → Jawab → Konfirmasi (jangan lompat langsung ke \"Jawab\"). Evaluasi: TIDAK defensif, TIDAK berdebat, TIDAK memaksa/menekan (termasuk tidak diskon refleks tanpa menjawab keberatan dulu), dan menutup dengan langkah lanjutan yang jelas (bukan menggantung). Kalau TIDAK ADA keberatan/keraguan sama sekali di percakapan ini, kembalikan skor null (jangan dipaksa menilai sesuatu yang tidak terjadi).",
    scoringGuide: {
      1: "Keberatan diabaikan, dijawab defensif/tersinggung, ATAU sales berdebat/memaksa pelanggan.",
      2: "Langsung ke tahap \"Jawab\" tanpa Dengar-Akui-Gali dulu (melompat tahap) — termasuk memberi diskon refleks tanpa menjawab keberatan lebih dulu.",
      3: "Ada pengakuan keberatan (Akui) tapi tidak digali lebih dalam sebelum menjawab — keberatan yang SEBENARNYA belum tentu ketemu.",
      4: "Ikuti alur Dengar→Akui→Gali→Jawab, jawaban memakai data/edukasi (bukan cuma diskon), tidak defensif, tidak menjelekkan kompetitor.",
      5: "Sama seperti 4, DITAMBAH Konfirmasi eksplisit di akhir (\"apakah ini menjawab kekhawatiran Bapak?\") DAN ada langkah lanjutan yang jelas (follow up/ringkasan) — percakapan tidak menggantung.",
    },
  },
];

// Tidak ada dimensi ber-`flag` di rubrik baru ini (beda dari rubrik lama
// yang punya 2 dimensi pattern-aggregation) — CORE_DIMENSIONS jadi berisi
// SEMUA 3 dimensi, PATTERN_DIMENSIONS kosong. rollup.js & weeklyNarrative.js
// tetap jalan aman dgn array kosong (sudah pola generik, tidak crash), cuma
// section "Pola Perilaku" dashboard otomatis tidak lagi dapat data baru.
export const CORE_DIMENSIONS = RUBRIC_DIMENSIONS.filter((d) => !d.flag);
export const PATTERN_DIMENSIONS = RUBRIC_DIMENSIONS.filter((d) => d.flag);

// ── Referensi pengetahuan produk & kesehatan (docs/knowledge_base/) ───────
const KB_FILES = [
  { file: "01-konsep-matras-sehat.md", label: "Konsep Matras Sehat" },
  { file: "02-harga-layanan.md", label: "Katalog Layanan & Harga" },
  { file: "02-SANO_Ensiklopedia_Dunia_Kasur - Skill.md", label: "Ensiklopedia Dunia Kasur" },
  { file: "03-sano-faq.md", label: "FAQ Pelanggan" },
];

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

// ── Referensi STANDAR SALES (docs/SANO_Sales_Framework/) — 27 Agustus 2026 ──
// Ini BUKAN referensi produk, tapi referensi PERILAKU/METODOLOGI konsultatif
// yang jadi dasar rubrik 3 dimensi di atas. Dibaca APA ADANYA (sama seperti
// loadKnowledgeContext), supaya LLM bisa merujuk contoh KALIMAT konkret
// (mis. "hindari vs lebih baik") dari modul aslinya, bukan cuma ringkasan
// scoringGuide di atas.
const SALES_FRAMEWORK_FILES = [
  { file: "SANO_Module_4_Communication_Skill.md", label: "Modul 4 — Communication Skill" },
  { file: "SANO_Module_6_Authority_Selling.md", label: "Modul 6 — Authority Selling" },
  { file: "SANO_Module_7_Objection_Handling.md", label: "Modul 7 — Objection Handling" },
];

export function loadSalesFrameworkContext() {
  const parts = [];
  const missing = [];
  for (const { file, label } of SALES_FRAMEWORK_FILES) {
    const fp = path.join(SALES_FRAMEWORK_DIR, file);
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

// Blok rubrik satu dimensi. `flag` (peninggalan rubrik lama) tetap didukung
// generik kalau suatu saat dipakai lagi, tapi TIDAK ADA dimensi yang
// memakainya di rubrik ini — jadi flagLine selalu kosong utk ketiganya.
function formatDimensionBlock(d) {
  const flagLine = d.flag
    ? `\n\nFlag boolean WAJIB (kunci JSON: "${d.flag.key}"): ${d.flag.question} Jawab true/false tegas kalau score dimensi ini terisi; kembalikan null HANYA kalau score-nya juga null. PENTING — LOKASI: "${d.flag.key}" harus jadi key DI DALAM objek "${d.key}" ini (sejajar dengan "score"/"quote"), BUKAN key terpisah di level atas/root JSON.`
    : "";
  return `### ${d.label} (kunci JSON: "${d.key}")\n${d.description}\n\nPanduan skor 1-5:\n${formatScoringGuide(d.scoringGuide)}${flagLine}`;
}

// "note" tunggal (rubrik lama) DIGANTI "strength"+"weakness" terpisah —
// permintaan eksplisit owner supaya output langsung terbaca pemilik bisnis
// tanpa parsing teks gabungan.
function formatOutputFieldSpec(d) {
  const flagPart = d.flag ? `, "${d.flag.key}": true/false atau null` : "";
  return `  "${d.key}": { "score": 1-5 atau null, "quote": "..." atau null, "strength": "..." atau null, "weakness": "..." atau null${flagPart} }`;
}

// Prompt sistem lengkap: instruksi + rubrik + 2 referensi (standar sales +
// pengetahuan produk). Ditaruh di `system` (bukan user message) supaya kena
// prompt caching Anthropic — SAMA utk semua percakapan dalam satu batch job,
// cuma transcript per-panggilan yang beda (lihat grading.js).
export function buildSystemPrompt() {
  const { context: kbContext, missing: kbMissing } = loadKnowledgeContext();
  const { context: frameworkContext, missing: frameworkMissing } = loadSalesFrameworkContext();
  const missing = [...kbMissing, ...frameworkMissing];
  const rubricText = RUBRIC_DIMENSIONS.map(formatDimensionBlock).join("\n\n");
  const outputSpec = RUBRIC_DIMENSIONS.map(formatOutputFieldSpec).join(",\n");

  return `Kamu adalah supervisor training SANO Care (Klinik Matras, "Ahlinya Kasur Sehat"). Tugasmu MENILAI (bukan membalas) transkrip percakapan WhatsApp antara seorang SALES/KONSULTAN dan seorang CUSTOMER, mengacu PERSIS pada 3 modul kurikulum resmi SANO Care Sales Framework di bawah — BUKAN standar penjualan generik.

ATURAN PENTING:
- Nilai HANYA berdasarkan apa yang benar-benar ada di transkrip. JANGAN menebak/mengarang hal yang tidak disebutkan.
- Fokus penilaian adalah APAKAH SALES BERPERILAKU SEBAGAI KONSULTAN KLINIK MATRAS sesuai framework di bawah — JANGAN menilai semata dari hasil (closing/tidak), nilai PROSES & PERILAKUnya.
- Kalau topik satu dimensi TIDAK PERNAH muncul di percakapan ini (mis. tidak ada keberatan sama sekali untuk "objectionHandling"), kembalikan score: null untuk dimensi itu — JANGAN memaksa angka 1-5 untuk sesuatu yang tidak terjadi.
- "quote" adalah kutipan LANGSUNG (1-2 kalimat) dari pesan SALES yang jadi bukti/contoh percakapan utama — kutip persis, jangan parafrase. null kalau skornya juga null.
- "strength" = SATU kalimat hal yang sudah BAGUS dari sales di dimensi ini (bahasa Indonesia, actionable, maksimal ~20 kata). null kalau tidak ada yang menonjol/skornya null.
- "weakness" = SATU kalimat hal yang PERLU DIPERBAIKI di dimensi ini (bahasa Indonesia, actionable, maksimal ~20 kata, mengacu ke framework modul — mis. "melompat ke tahap Jawab tanpa Dengar-Akui-Gali dulu"). null kalau tidak ada kelemahan berarti/skornya null.
- Fokus HANYA pada pesan dari SALES (OUTBOUND). Pesan customer (INBOUND) dipakai sebagai KONTEKS untuk menilai respons sales, bukan dinilai sendiri.
- Ini PELENGKAP sistem deteksi pelanggaran yang sudah ada secara terpisah (klaim garansi salah, janji medis, dst) — JANGAN ulang menilai pelanggaran compliance di sini, fokus ke SUBSTANSI/PERILAKU konsultatif.

RUBRIK PENILAIAN (3 modul SANO Care Sales Framework):

${rubricText}

REFERENSI STANDAR SALES SANO CARE (isi lengkap 3 modul — rujuk contoh kalimat/alur konkret di dalamnya untuk menilai, bukan cuma scoringGuide ringkas di atas):

${frameworkContext || "(Tidak ada referensi modul termuat.)"}

REFERENSI PENGETAHUAN PRODUK & KESEHATAN (dipakai untuk menilai akurasi kalau sales membahas produk/mekanisme kesehatan — sales tidak wajib menyebut semua ini, tapi apa yang DIA sebutkan harus konsisten dengan referensi ini):

${kbContext || "(Tidak ada referensi produk termuat.)"}

FORMAT OUTPUT — WAJIB JSON valid, TANPA teks lain di luar JSON, dengan struktur PERSIS ini:
{
${outputSpec},
  "overallNote": "satu kalimat ringkasan coaching keseluruhan percakapan ini"
}${missing.length ? `\n\n(Catatan internal — file referensi berikut tidak ditemukan saat prompt ini dibuat: ${missing.join(", ")})` : ""}`;
}
