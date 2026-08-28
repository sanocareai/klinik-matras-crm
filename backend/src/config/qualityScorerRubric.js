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
    // Perkuatan (28 Agustus 2026) berdasarkan SOP resmi Modul 7 — TIDAK
    // mengubah scoringGuide/description di atas, murni field TAMBAHAN di
    // dalam objek dimensi yang sama. `extraFields` generik (didukung
    // formatDimensionBlock/formatOutputFieldSpec di bawah + dimResult di
    // job.js) — dipakai objectionHandling di sini, tapi bisa dipakai
    // dimensi lain nanti tanpa ubah kode ekstraksi.
    extraFields: [
      {
        key: "objectionType",
        kind: "enum",
        values: ["HARGA", "MENUNDA", "KEPERCAYAAN", "OTORITAS_KEPUTUSAN", "KEBUTUHAN", "PEMBANDING"],
        question:
          "Jenis keberatan yang diutarakan pelanggan — pilih SATU dari 6 nilai berikut (sesuai Modul 7): " +
          "HARGA (\"mahal\", \"belum ada budget\", \"di tempat lain lebih murah\"), " +
          "MENUNDA (\"pikir-pikir dulu\", \"nanti saja\"), " +
          "KEPERCAYAAN (\"yakin awet?\", \"takut kecewa\"), " +
          "OTORITAS_KEPUTUSAN (\"harus tanya pasangan/keluarga dulu\"), " +
          "KEBUTUHAN (\"kasur masih bisa dipakai\", \"belum terlalu mengganggu\"), " +
          "PEMBANDING (\"di toko sebelah modelnya mirip\", \"merek X katanya bagus\"). " +
          "Kalau ada lebih dari satu jenis di percakapan yang sama, pilih yang PALING DOMINAN/pertama muncul.",
        hasQuote: true,
      },
      // akuiPresent/galiPresent (28 Agustus 2026, GANTI frameworkFollowed
      // tunggal) — ditemukan lewat investigasi gold-standard: boolean
      // gabungan lama ("Dengar-Akui-Gali sbg satu true/false") ke-satisfy
      // oleh basa-basi rutin ("baik kak", "memang ibu") yang muncul identik
      // di banyak tempat lain pada percakapan yang sama, BUKAN validasi
      // empati sungguhan yang menyasar isi keberatan. Dipecah jadi 2 field
      // independen (pola sama dgn objectionType/frameworkFollowed
      // sebelumnya) supaya masing-masing bisa dinilai & diverifikasi
      // terpisah. frameworkFollowed TETAP ADA di schema (kompatibilitas
      // data lama) tapi mulai sekarang DIHITUNG DI KODE sbg
      // AND(akuiPresent, galiPresent) — lihat job.js#dimResult — BUKAN
      // diminta langsung ke LLM lagi.
      {
        key: "akuiPresent",
        kind: "boolean",
        question:
          "Apakah sales memvalidasi/mengakui SECARA SPESIFIK ALASAN DI BALIK keberatan pelanggan — BUKAN sekadar menerima keputusan/hasil akhirnya? " +
          "Kalimat yang MEMENUHI: secara eksplisit menyebut ULANG atau merespons ALASAN/PERASAAN spesifik yang baru diucapkan pelanggan. Contoh: kalau pelanggan bilang \"mau saya obrolin dulu sama istri\", Akui yang VALID menyebut soal DISKUSI/KEPUTUSAN BERSAMA (\"wajar sekali, ini memang baiknya didiskusikan dulu bersama pasangan\") — BUKAN cuma \"baik, kami tunggu kabar baiknya\" (itu CUMA menerima PENUNDAANNYA, TIDAK memvalidasi ALASANNYA — tetap dihitung GAGAL/false meski terdengar sopan). " +
          "Kalimat yang TIDAK MEMENUHI (JANGAN dihitung sebagai bukti Akui): " +
          "(a) frasa generik yang MUNCUL BERULANG identik di bagian LAIN percakapan yang sama untuk merespons hal yang TIDAK ADA hubungannya dengan keberatan — mis. \"baik kak\", \"baik ibu\", \"siap\", \"terima kasih\"; " +
          "(b) kalimat yang HANYA menyatakan \"oke/baik/kami tunggu\" tanpa menyebut ULANG substansi keberatannya sama sekali; " +
          "(c) PERTANYAAN klarifikasi — itu masuk kategori galiPresent, BUKAN akuiPresent. akuiPresentQuote WAJIB kutipan yang BERBEDA dari galiPresentQuote — JANGAN PERNAH memakai kalimat pertanyaan yang sama utk kedua field. " +
          "Kalau TIDAK ADA kalimat yang secara eksplisit memvalidasi ALASAN keberatan (terpisah dari sekadar menerima hasil ATAU dari pertanyaan klarifikasi), jawab false — JANGAN dipaksakan hanya karena sales terdengar sopan/tidak defensif. " +
          "LANGKAH WAJIB SEBELUM MENJAWAB: bandingkan isi akuiPresentQuote yang akan kamu tulis dengan galiPresentQuote yang akan kamu tulis utk field galiPresent. Kalau keduanya menunjuk ke KALIMAT YANG SAMA atau tumpang tindih signifikan (mis. satu pertanyaan yang sama dipakai utk dua alasan berbeda), maka kalimat itu HANYA boleh dihitung utk SATU field — pilih galiPresent (karena pertanyaan klarifikasi lebih konkret dideteksi), dan akuiPresent HARUS kamu jawab false dgn akuiPresentQuote null, KECUALI ada kalimat LAIN yang terpisah dan benar-benar memvalidasi alasan keberatan.",
        hasQuote: true,
      },
      {
        key: "galiPresent",
        kind: "boolean",
        question:
          "Apakah sales mengajukan PERTANYAAN KLARIFIKASI yang menggali keberatan SEBENARNYA SEBELUM menjawab/menjelaskan (bukan langsung menjelaskan/membantah)? " +
          "mis. \"boleh tau lebih detail apa yang jadi pertimbangan Bapak/Ibu?\", \"budget yang tersedia saat ini di kisaran berapa?\". " +
          "PENTING: galiPresentQuote WAJIB kutipan yang BERBEDA dari akuiPresentQuote. Kalau HANYA ADA satu kalimat gabungan yang isinya pertanyaan probing TANPA ada validasi empati terpisah sebelumnya, kategorikan itu SEBAGAI galiPresent=true SAJA (akuiPresent tetap false, karena validasi terpisahnya memang tidak ada) — JANGAN pernah menandai kalimat yang sama sbg bukti KEDUA field sekaligus. " +
          "false kalau sales langsung masuk ke penjelasan/justifikasi/harga tanpa bertanya lebih dulu.",
        hasQuote: true,
      },
    ],
  },
  {
    key: "evidenceBasedSelling",
    label: "Evidence-Based Selling",
    description:
      "Modul 6 SANO Care (bagian Bukti & Struktur Authority Communication): menilai APAKAH sales memakai bukti konkret (foto/video/pengukuran) DAN mengikuti struktur komunikasi authority (Referensi hasil konsultasi → Kesimpulan pakai kata hedge → Sebab-akibat → Solusi) saat menyampaikan rekomendasi solusi/upgrade. BEDA dari dimensi Authority Selling di atas (struktur rekomendasi secara umum) — dimensi ini fokus SPESIFIK ke PENGGUNAAN BUKTI KONKRET dan KEPATUHAN 4 LANGKAH STRUKTUR saat presentasi solusi. Kalau percakapan belum sampai tahap presentasi solusi/rekomendasi sama sekali, kembalikan score: null.",
    scoringGuide: {
      1: "Rekomendasi diberikan tanpa struktur authority sama sekali (langsung solusi tanpa referensi data/hedge/sebab-akibat) DAN tanpa bukti konkret apa pun (evidenceUsed=TIDAK_ADA).",
      2: "Ada sedikit struktur (mis. sekadar menyebut data pelanggan) tapi TIDAK ADA bukti konkret dipakai, ATAU bukti dikirim tanpa penjelasan makna sama sekali.",
      3: "Struktur authority sebagian diikuti (sebagian dari 4 langkah) DAN/ATAU bukti dipakai tapi penjelasannya minim/tidak lengkap.",
      4: "4 langkah struktur authority diikuti dengan baik DAN minimal 1 bukti konkret dipakai serta dijelaskan maknanya (bukan cuma dikirim mentah).",
      5: "Sama seperti 4, DITAMBAH lebih dari 1 jenis bukti dipakai, DAN/ATAU story selling dipakai dengan benar (tanpa menjanjikan hasil pasti sama utk semua orang).",
    },
    secondQuote: true,
    extraFields: [
      {
        key: "authorityStructureFollowed",
        kind: "boolean",
        question:
          "Apakah sales mengikuti 4 langkah Struktur Authority Communication SECARA BERURUTAN saat menyampaikan rekomendasi solusi: (1) Referensi hasil konsultasi (\"Berdasarkan hasil konsultasi tadi...\", \"Dari informasi yang Bapak sampaikan...\"), (2) Kesimpulan pakai kata HEDGE (\"kemungkinan\", \"dapat memengaruhi\") BUKAN kata pasti (\"pasti\", \"sudah pasti\", \"jelas\"), (3) Jelaskan mekanisme sebab-akibat dengan bahasa sederhana, (4) Hubungkan ke solusi (bukan langsung \"harus beli ini\"). true kalau KESELURUHAN 4 langkah dijalankan berurutan; false kalau ada langkah yang dilompati/dibalik urutannya.",
      },
      {
        key: "evidenceUsed",
        kind: "enum_array",
        values: ["FOTO_PEMBONGKARAN", "VIDEO", "UJI_GAYA_DORONG", "UJI_STABILITAS", "PENGUKURAN", "TIDAK_ADA"],
        question:
          "Jenis bukti konkret apa saja yang dipakai sales saat presentasi solusi — pilih SEMUA yang relevan dari 6 nilai berikut (sesuai Modul 6): " +
          "FOTO_PEMBONGKARAN (foto fondasi patah/busa hancur/pegas rusak/lapisan kempes), " +
          "VIDEO (proses pemeriksaan/upgrade/hasil akhir), " +
          "UJI_GAYA_DORONG (perbandingan sebelum vs sesudah), " +
          "UJI_STABILITAS (kasur bergelombang vs stabil), " +
          "PENGUKURAN (angka konkret, mis. \"penurunan kasur 3cm dibanding standar maksimal 1cm\"), " +
          "TIDAK_ADA (tidak ada bukti konkret dipakai sama sekali — HANYA pakai nilai ini SENDIRIAN, jangan digabung dengan nilai lain).",
      },
      {
        key: "evidenceExplained",
        kind: "boolean",
        question:
          "Kalau ada bukti konkret dipakai (evidenceUsed bukan TIDAK_ADA): apakah sales MENJELASKAN MAKNA bukti itu, bukan cuma mengirim foto/video/angka mentah? Contoh BENAR: \"Foto ini menunjukkan kondisi fondasi setelah dibongkar. Terlihat beberapa bagian sudah mengalami penurunan sehingga topangan tubuh tidak lagi merata.\" Contoh SALAH: kirim foto tanpa keterangan apa pun. Kembalikan null kalau evidenceUsed = TIDAK_ADA (tidak relevan menilai penjelasan bukti yang memang tidak ada).",
      },
      {
        key: "storySellingUsed",
        kind: "boolean",
        question:
          "Apakah sales memakai STORY SELLING (struktur: Profil pelanggan lain → Keluhan → Hasil Konsultasi → Solusi → Hasil) sebagai bagian dari presentasi solusi? CATATAN: kalau story selling dipakai TAPI menjanjikan hasil PASTI SAMA utk semua orang (klaim mutlak), JANGAN buat field/flag terpisah utk itu — sebutkan saja di \"weakness\" atau salah satu kutipan (\"quote\"/\"quote2\") dimensi ini.",
      },
    ],
  },
];

// ── Tool schema PER-DIMENSI utk native structured output (Anthropic tool
// use) ─────────────────────────────────────────────────────────────────────
// (28 Agustus 2026, fix bug JSON-escaping ~5-7% gagal parse — percobaan ke-2)
// Percobaan PERTAMA (1 tool gabungan utk 3 dimensi sekaligus) DIBATALKAN:
// diverifikasi live thd batch sungguhan, tool_choice paksa + skema besar
// (3 objek bersarang, tiap objek beberapa field teks panjang) bikin model
// (Haiku) SERING berhenti generate setelah dimensi PERTAMA saja (communication
// Skill terisi lengkap, authoritySelling+objectionHandling hilang TOTAL dari
// hasil) — stop_reason "tool_use" (bukan terpotong maxTokens), jadi `required`
// di JSON schema TIDAK cukup dijamin Anthropic utk skema sebesar itu. Rasio
// gagal jauh LEBIH BURUK (~88% pada sampel awal) dari bug asli yang mau
// diperbaiki — sudah di-revert (lihat commit revert 27-28 Agustus 2026).
//
// Percobaan KEDUA (di sini): PECAH jadi 1 tool call TERPISAH per dimensi —
// skema tiap panggilan jadi jauh lebih kecil (cuma field 1 dimensi), yang
// diharapkan menghindari perilaku "berhenti setelah objek pertama" di atas
// sepenuhnya (tidak ada "objek kedua/ketiga" yang bisa terlewat kalau
// panggilannya memang cuma menghasilkan SATU objek). Trade-off yang SADAR
// diambil & DILAPORKAN ke owner: transcript (di grading.js) TIDAK di-cache
// Anthropic (beda dari systemPrompt yang cache ephemeral) — dikirim ulang
// PENUH di setiap dari 3 panggilan per percakapan, jadi biaya token
// transcript naik ~3x dibanding versi 1-panggilan. System prompt tetap 1x
// biaya penuh + 2x cache-read (jauh lebih murah), jadi kenaikan total biaya
// tidak sampai 3x, tapi TIDAK NOL — diukur & dilaporkan terpisah stlh live
// test, bukan diasumsikan kecil.
export function buildDimensionTool(d, { includeOverallNote = false } = {}) {
  const schema = dimensionSchema(d);
  const properties = { ...schema.properties };
  const required = [...schema.required];
  if (includeOverallNote) {
    properties.overallNote = { type: "string" };
    required.push("overallNote");
  }
  return {
    name: `submit_penilaian_${d.key}`,
    description: `Kirim hasil penilaian dimensi "${d.label}" (${d.description.split(":")[0]}) utk percakapan ini, sesuai rubrik SANO Care Sales Framework.`,
    input_schema: { type: "object", properties, required, additionalProperties: false },
  };
}

function extraFieldSchema(ef) {
  const props = {};
  if (ef.kind === "enum_array") {
    // 28 Agustus 2026 (Evidence-Based Selling) — multi-select. TIDAK nullable
    // (selalu array, boleh kosong) — konsisten dgn evidenceUsed String[] di
    // Prisma yang juga tidak bisa null, lihat catatan di schema.prisma.
    props[ef.key] = { type: "array", items: { type: "string", enum: ef.values } };
  } else if (ef.kind === "enum") {
    props[ef.key] = { type: ["string", "null"], enum: [...ef.values, null] };
  } else {
    props[ef.key] = { type: ["boolean", "null"] };
  }
  const required = [ef.key];
  if (ef.hasQuote) {
    props[`${ef.key}Quote`] = { type: ["string", "null"] };
    required.push(`${ef.key}Quote`);
  }
  return { props, required };
}

function dimensionSchema(d) {
  const properties = {
    score: { type: ["integer", "null"], minimum: 1, maximum: 5 },
    quote: { type: ["string", "null"] },
    strength: { type: ["string", "null"] },
    weakness: { type: ["string", "null"] },
  };
  const required = ["score", "quote", "strength", "weakness"];
  if (d.flag) {
    properties[d.flag.key] = { type: ["boolean", "null"] };
    required.push(d.flag.key);
  }
  // `secondQuote` (28 Agustus 2026, Evidence-Based Selling) — generik spt
  // `flag`/`extraFields`: dimensi yang TIDAK set ini tidak berubah sama
  // sekali (A-F & Fase 1 tetap byte-identical). Dipakai utk dimensi dgn
  // banyak field tambahan yang kutipannya SENGAJA digabung jadi maks 2
  // kutipan TOTAL (bukan 1 kutipan/field spt pola Fase 1).
  if (d.secondQuote) {
    properties.quote2 = { type: ["string", "null"] };
    required.push("quote2");
  }
  for (const ef of d.extraFields || []) {
    const { props, required: efRequired } = extraFieldSchema(ef);
    Object.assign(properties, props);
    required.push(...efRequired);
  }
  return { type: "object", properties, required, additionalProperties: false };
}

export function buildDimensionTools() {
  return RUBRIC_DIMENSIONS.map((d, i) =>
    buildDimensionTool(d, { includeOverallNote: i === RUBRIC_DIMENSIONS.length - 1 })
  );
}

// ── Ekstraksi HANYA field tambahan (28 Agustus 2026, backfill akuiPresent/
// galiPresent) ──────────────────────────────────────────────────────────────
// Dipakai scripts/backfillAkuiGali.js utk RE-EXTRACT extraFields SATU
// dimensi TANPA menyentuh score/quote/strength/weakness-nya (beda dari
// buildDimensionTool() yang selalu minta full re-grading dimensi). Reuse
// extraFieldSchema()/formatExtraFieldLine() yang SAMA dgn full grading —
// menjamin kriteria backfill data lama IDENTIK dgn kriteria grading baru
// utk data baru, tidak ada drift antara 2 jalur.
export function buildExtraFieldsTool(d) {
  const properties = {};
  const required = [];
  for (const ef of d.extraFields || []) {
    const { props, required: efRequired } = extraFieldSchema(ef);
    Object.assign(properties, props);
    required.push(...efRequired);
  }
  return {
    name: `submit_extra_fields_${d.key}`,
    description: `Ekstrak HANYA field terstruktur tambahan dimensi "${d.label}" dari transkrip ini — BUKAN skor/kutipan utama dimensi (itu tidak diminta di sini).`,
    input_schema: { type: "object", properties, required, additionalProperties: false },
  };
}

export function buildExtraFieldsPrompt(d) {
  const extraLines = (d.extraFields || []).map((ef) => formatExtraFieldLine(d, ef)).join("");
  return `Kamu supervisor training SANO Care (Klinik Matras). Fokus HANYA pada aspek "${d.label}" berikut ini dari transkrip percakapan yang diberikan:\n${d.description}\n${extraLines}\n\nJawab HANYA field terstruktur di atas sesuai instruksi masing-masing. JANGAN beri skor 1-5 atau kutipan umum lain — itu di luar cakupan tugas ini. Fokus HANYA pada pesan berlabel [SALES]; pesan [CUSTOMER] cuma konteks.`;
}

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
//
// `extraFields` (28 Agustus 2026) — mekanisme GENERIK utk field terstruktur
// tambahan per dimensi (dipakai objectionHandling: objectionType/
// frameworkFollowed). Instruksi nesting DIULANG SENGAJA sama tegasnya
// dengan flagLine — pelajaran dari bug live (17-58% flag lama hilang
// karena LLM naruh di root JSON, bukan di dalam objek dimensinya).
function formatExtraFieldLine(d, ef) {
  let valueHint;
  if (ef.kind === "enum_array") {
    valueHint = `ARRAY berisi SATU ATAU LEBIH nilai dari [${ef.values.join(", ")}] (multi-select — boleh lebih dari satu kalau relevan). Kembalikan array KOSONG [] HANYA kalau score dimensi ini null (topik belum muncul); kalau score terisi tapi memang tidak ada yang relevan, pakai array berisi elemen terakhir di daftar sendirian (JANGAN digabung dengan nilai lain)`;
  } else if (ef.kind === "enum") {
    valueHint = `salah satu dari [${ef.values.join(", ")}], atau null`;
  } else {
    valueHint = "true/false, atau null";
  }
  const quoteNote = ef.hasQuote
    ? ` Sertakan juga "${ef.key}Quote" (kutipan bukti singkat dari pesan SALES, atau null kalau "${ef.key}" juga null).`
    : "";
  const keysList = ef.hasQuote ? `"${ef.key}" dan "${ef.key}Quote"` : `"${ef.key}"`;
  return `\n\nField tambahan WAJIB (kunci JSON: "${ef.key}"): ${ef.question} Jawab ${valueHint}.${quoteNote} PENTING — LOKASI: ${keysList} harus jadi key DI DALAM objek "${d.key}" ini (sejajar dengan "score"/"quote"), BUKAN key terpisah di level atas/root JSON — sama seperti aturan flag boolean di atas.`;
}

function formatDimensionBlock(d) {
  const flagLine = d.flag
    ? `\n\nFlag boolean WAJIB (kunci JSON: "${d.flag.key}"): ${d.flag.question} Jawab true/false tegas kalau score dimensi ini terisi; kembalikan null HANYA kalau score-nya juga null. PENTING — LOKASI: "${d.flag.key}" harus jadi key DI DALAM objek "${d.key}" ini (sejajar dengan "score"/"quote"), BUKAN key terpisah di level atas/root JSON.`
    : "";
  // `secondQuote` (28 Agustus 2026) — dimensi dgn banyak field tambahan yang
  // kutipannya SENGAJA digabung jadi maks 2 kutipan TOTAL utk dimensi ini,
  // BUKAN 1 kutipan per field tambahan (beda dari pola Fase 1).
  const secondQuoteLine = d.secondQuote
    ? `\n\nKutipan bukti dimensi ini DIBATASI maksimal 2 TOTAL (bukan per field tambahan) — isi "quote" dengan kutipan PALING MENONJOL, dan "quote2" (kunci JSON tambahan, DI DALAM objek "${d.key}" ini, sejajar "quote") dengan kutipan KEDUA paling menonjol kalau ada (soal struktur authority, ATAU bukti yang dipakai, ATAU story selling). null kalau tidak ada kutipan kedua yang relevan atau skornya null.`
    : "";
  const extraLines = (d.extraFields || []).map((ef) => formatExtraFieldLine(d, ef)).join("");
  return `### ${d.label} (kunci JSON: "${d.key}")\n${d.description}\n\nPanduan skor 1-5:\n${formatScoringGuide(d.scoringGuide)}${flagLine}${secondQuoteLine}${extraLines}`;
}

// "note" tunggal (rubrik lama) DIGANTI "strength"+"weakness" terpisah —
// permintaan eksplisit owner supaya output langsung terbaca pemilik bisnis
// tanpa parsing teks gabungan.
function formatOutputFieldSpec(d) {
  const flagPart = d.flag ? `, "${d.flag.key}": true/false atau null` : "";
  const quote2Part = d.secondQuote ? `, "quote2": "..." atau null` : "";
  const extraParts = (d.extraFields || []).map((ef) => {
    let valueHint;
    if (ef.kind === "enum_array") valueHint = `["${ef.values[0]}", ...] (array)`;
    else if (ef.kind === "enum") valueHint = `"${ef.values[0]}" (atau nilai enum lain)|null`;
    else valueHint = "true/false atau null";
    const quotePart = ef.hasQuote ? `, "${ef.key}Quote": "..." atau null` : "";
    return `, "${ef.key}": ${valueHint}${quotePart}`;
  }).join("");
  return `  "${d.key}": { "score": 1-5 atau null, "quote": "..." atau null, "strength": "..." atau null, "weakness": "..." atau null${flagPart}${quote2Part}${extraParts} }`;
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
- Beberapa dimensi (lihat definisi di bawah) punya field terstruktur TAMBAHAN (enum atau boolean) selain score/quote/strength/weakness — field itu WAJIB dijawab dengan nilai TEGAS (bukan teks bebas) kalau score dimensi itu terisi, dan ikut null hanya kalau score-nya juga null. Field tambahan itu WAJIB jadi key DI DALAM objek dimensinya sendiri — JANGAN PERNAH ditaruh sebagai key terpisah di level atas/root JSON, sekalipun nama key-nya sudah unik.
- Fokus HANYA pada pesan dari SALES (OUTBOUND). Pesan customer (INBOUND) dipakai sebagai KONTEKS untuk menilai respons sales, bukan dinilai sendiri.
- Ini PELENGKAP sistem deteksi pelanggaran yang sudah ada secara terpisah (klaim garansi salah, janji medis, dst) — JANGAN ulang menilai pelanggaran compliance di sini, fokus ke SUBSTANSI/PERILAKU konsultatif.

RUBRIK PENILAIAN (3 modul SANO Care Sales Framework):

${rubricText}

REFERENSI STANDAR SALES SANO CARE (isi lengkap 3 modul — rujuk contoh kalimat/alur konkret di dalamnya untuk menilai, bukan cuma scoringGuide ringkas di atas):

${frameworkContext || "(Tidak ada referensi modul termuat.)"}

REFERENSI PENGETAHUAN PRODUK & KESEHATAN (dipakai untuk menilai akurasi kalau sales membahas produk/mekanisme kesehatan — sales tidak wajib menyebut semua ini, tapi apa yang DIA sebutkan harus konsisten dengan referensi ini):

${kbContext || "(Tidak ada referensi produk termuat.)"}

FORMAT OUTPUT — WAJIB JSON valid, TANPA teks lain di luar JSON, dengan struktur PERSIS ini (PERHATIKAN: setiap field tambahan seperti "objectionType"/"frameworkFollowed" ada DI DALAM kurung kurawal objek dimensinya masing-masing, BUKAN key terpisah sejajar "overallNote" di root):
{
${outputSpec},
  "overallNote": "satu kalimat ringkasan coaching keseluruhan percakapan ini"
}${missing.length ? `\n\n(Catatan internal — file referensi berikut tidak ditemukan saat prompt ini dibuat: ${missing.join(", ")})` : ""}`;
}
