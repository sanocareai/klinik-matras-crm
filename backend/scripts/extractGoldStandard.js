// ═══ EKSTRAKSI GOLD-STANDARD EXAMPLES (28 Agustus 2026) ═══════════════════
// Satu-off / on-demand — TIDAK didaftarkan sbg cron job. Jalankan manual:
//   docker compose exec backend node scripts/extractGoldStandard.js
//
// MURNI pengumpulan referensi utk pengembangan chatbot Oktober — TIDAK
// re-grading, TIDAK menyentuh ConversationQualityScore, TIDAK terhubung ke
// sistem/fitur apa pun. Alurnya:
//   1. Per kategori (8 label tetap, SOP Modul 4/6/7), query kandidat
//      percakapan yang SUDAH lolos threshold skor+flag dari grading yang
//      sudah ada (bukan query baru yang menghitung ulang apa pun).
//   2. Utk tiap kandidat (mulai dari skor tertinggi), 1 panggilan LLM
//      RINGAN & TERPISAH dari job grading utama — bukan minta skor lagi,
//      cuma "apakah teknik ini BENAR-BENAR terlihat jelas, kalau ya kutip".
//   3. Berhenti per kategori begitu TARGET_PER_CATEGORY contoh terkumpul,
//      atau kandidat habis (dilaporkan sbg 0/kurang kalau memang begitu).
//   4. Simpan ke tabel GoldStandardExample + ekspor markdown utk ditinjau
//      manual (docs/gold-standard-examples.md).
//
// Native tool-use (Anthropic, bukan JSON.parse teks bebas) dipakai dari
// awal di sini — pelajaran dari investigasi bug JSON-escaping (28 Agustus
// 2026, Quality Scorer): skema KECIL per panggilan (2 field: present +
// quotes) jauh lebih reliable drpd skema besar, dan ini one-off yang
// hasilnya ditinjau manual, jadi keandalan ekstraksi lebih penting drpd
// hemat 1 kali panggilan tambahan.
import { prisma } from "../src/db.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { fetchTranscriptMessages, formatTranscript, resolveApiKey } from "../src/services/qualityScorer/grading.js";
import { chatWithTools } from "../src/services/providers/anthropicProvider.js";
import { QUALITY_SCORER_MODEL } from "../src/config/qualityScorerRubric.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TARGET_PER_CATEGORY = 5;
const MAX_QUOTES_PER_EXAMPLE = 2;

// 8 kategori TETAP — JANGAN tambah/ubah tanpa konfirmasi (lihat ticket).
// `where` = filter Prisma murni dari field yang SUDAH ADA & SUDAH
// dikonfirmasi akurat (skor dimensi rubrik baru + flag Fase 1, ATAU flag
// legacy dimensi lama E/F utk 2 kategori yang tidak punya sinyal terstruktur
// di rubrik AKTIF — CLOSING_ASK & COMMUNICATION_PLAIN_LANGUAGE, lihat
// catatan di bawah).
const CATEGORIES = [
  {
    key: "AUTHORITY_REFERENSI",
    description:
      "Pembukaan rekomendasi dengan merujuk EKSPLISIT ke hasil konsultasi sebelumnya, mis. \"Berdasarkan hasil konsultasi tadi...\", \"Dari informasi yang Bapak/Ibu sampaikan...\".",
    where: { authoritySellingScore: { gte: 4 } },
    scoreColumn: "authoritySellingScore",
  },
  {
    key: "AUTHORITY_HEDGE_LANGUAGE",
    description:
      "Kesimpulan/rekomendasi memakai kata HEDGE (\"kemungkinan\", \"dapat memengaruhi\", \"kemungkinan besar\") — BUKAN kata pasti (\"pasti\", \"sudah pasti\", \"jelas\").",
    where: { authoritySellingScore: { gte: 4 } },
    scoreColumn: "authoritySellingScore",
  },
  {
    key: "OBJECTION_AKUI",
    description:
      "Validasi EMPATI eksplisit atas keberatan pelanggan SEBELUM menjawab, mis. \"saya paham kekhawatiran Bapak/Ibu\", \"wajar kalau ragu soal itu\".",
    where: { frameworkFollowed: true, objectionHandlingScore: { gte: 4 } },
    scoreColumn: "objectionHandlingScore",
  },
  {
    key: "OBJECTION_GALI",
    description:
      "Pertanyaan KLARIFIKASI yang menggali keberatan SEBENARNYA sebelum menjawab (bukan langsung berasumsi/langsung menjawab), mis. \"boleh tau lebih detail apa yang jadi pertimbangan Bapak/Ibu?\".",
    where: { frameworkFollowed: true, objectionHandlingScore: { gte: 4 } },
    scoreColumn: "objectionHandlingScore",
  },
  {
    key: "OBJECTION_REFRAME_HARGA",
    description:
      "Teknik reframe HARGA — mengubah persepsi biaya jadi investasi/biaya per malam pemakaian/perbandingan nilai jangka panjang, BUKAN sekadar menawarkan diskon.",
    where: { objectionType: "HARGA", objectionHandlingScore: { gte: 4 } },
    scoreColumn: "objectionHandlingScore",
  },
  {
    key: "CLOSING_ASK",
    description:
      "Ajakan KOMITMEN/next step eksplisit setelah presentasi solusi/harga (bukan menggantung tanpa arah), mis. \"apakah bisa kita proses sekarang?\", \"kapan waktu yang pas saya follow up lagi?\".",
    // CATATAN: rubrik AKTIF (Communication/Authority/Objection/Evidence-Based
    // Selling) tidak punya field terstruktur "closing ask" — sinyal ini
    // datang dari dimensi LEGACY (E, sebelum rubrik diganti 27 Agustus 2026),
    // masih ada di kolom DB tapi TIDAK ditulis lagi oleh grading saat ini.
    // Dipakai di sini krn ticket eksplisit merujuk "dimensi A-F" sbg sumber
    // valid, dan tidak ada pengganti di rubrik baru utk sinyal spesifik ini.
    where: { closingAskPresent: true, closingAssertivenessScore: { gte: 4 } },
    scoreColumn: "closingAssertivenessScore",
    legacyDimension: true,
  },
  {
    key: "COMMUNICATION_VALIDATION",
    description:
      "Validasi EKSPLISIT atas jawaban pelanggan SEBELUM lanjut ke pertanyaan berikutnya, mis. \"baik Pak, saya catat\", \"berarti keluhannya di ... ya\".",
    where: { communicationSkillScore: { gte: 4 } },
    scoreColumn: "communicationSkillScore",
  },
  {
    key: "COMMUNICATION_PLAIN_LANGUAGE",
    description:
      "Istilah/penjelasan TEKNIS yang diterjemahkan ke bahasa AWAM dalam kalimat yang sama, mis. \"Pocket Spring — per yang dibungkus satu-satu jadi lebih senyap\".",
    // Sama catatan dgn CLOSING_ASK — sinyal ini dari dimensi legacy F,
    // rubrik aktif tidak punya field terstruktur setara (communicationSkill
    // level 5 menyebutnya di scoringGuide tapi TIDAK ADA baris score=5 sama
    // sekali di data production saat ini — dicek langsung sebelum ekstraksi,
    // bukan diasumsikan).
    where: { plainLanguageUsed: true, customerComprehensionScore: { gte: 4 } },
    scoreColumn: "customerComprehensionScore",
    legacyDimension: true,
  },
];

function buildExtractionTool() {
  return {
    name: "submit_gold_standard",
    description: "Tentukan apakah transkrip ini benar-benar mendemonstrasikan satu teknik SOP spesifik, dan kalau ya, ekstrak kutipan langsung.",
    input_schema: {
      type: "object",
      properties: {
        present: { type: "boolean" },
        quotes: { type: "array", items: { type: "string" }, maxItems: MAX_QUOTES_PER_EXAMPLE },
      },
      required: ["present", "quotes"],
      additionalProperties: false,
    },
  };
}

function buildExtractionPrompt(cat) {
  return `Kamu supervisor training SANO Care (Klinik Matras). Tugasmu: tentukan apakah SATU teknik SOP spesifik didemonstrasikan dengan JELAS oleh SALES di transkrip berikut, dan kalau ya, ekstrak maksimal ${MAX_QUOTES_PER_EXAMPLE} kutipan LANGSUNG (persis kata-kata sales, JANGAN diparafrase) yang membuktikannya.

TEKNIK YANG DICARI (kunci: "${cat.key}"):
${cat.description}

ATURAN:
- "present": true HANYA kalau teknik ini BENAR-BENAR jelas terlihat, bukan sekadar "mirip-mirip" atau "berpotensi". Kalau ragu, jawab false.
- "quotes": kutipan PERSIS dari pesan berlabel [SALES] (boleh dipotong dengan "..." kalau kalimat sangat panjang, tapi tidak boleh diparafrase). Array kosong kalau present=false.
- Data pelanggan (nama/nomor HP) di transkrip SUDAH disamarkan otomatis — JANGAN mencoba menebak atau menuliskan ulang identitas asli, cukup kutip apa adanya.
- Fokus HANYA pada pesan [SALES]. Pesan [CUSTOMER] cuma konteks, bukan bagian dari kutipan.
- Ini murni tugas EKSTRAKSI kutipan, BUKAN penilaian ulang skor.`;
}

async function extractOne(cat, candidate, apiKey) {
  const conv = await prisma.conversation.findUnique({
    where: { id: candidate.conversationId },
    include: { customer: { select: { name: true } } },
  });
  if (!conv) return null;

  const selesai = new Date();
  const messages = await fetchTranscriptMessages(candidate.conversationId, selesai);
  if (messages.length === 0) return null;
  const transcriptText = formatTranscript(messages, conv.customer?.name);

  const tool = buildExtractionTool();
  const { toolCalls } = await chatWithTools({
    apiKey,
    model: QUALITY_SCORER_MODEL,
    systemPrompt: buildExtractionPrompt(cat),
    messages: [{ role: "user", content: `Transkrip:\n\n${transcriptText}` }],
    tools: [tool],
    toolChoice: { type: "tool", name: tool.name },
    maxTokens: 400,
  });

  const call = toolCalls.find((c) => c.name === tool.name);
  if (!call || !call.input.present || !Array.isArray(call.input.quotes) || call.input.quotes.length === 0) {
    return null;
  }
  return call.input.quotes.slice(0, MAX_QUOTES_PER_EXAMPLE).filter((q) => typeof q === "string" && q.trim());
}

async function main() {
  const apiKey = resolveApiKey();
  const report = [];

  for (const cat of CATEGORIES) {
    const candidates = await prisma.conversationQualityScore.findMany({
      where: cat.where,
      select: { conversationId: true, salesName: true, sampledFor: true, [cat.scoreColumn]: true },
      orderBy: { [cat.scoreColumn]: "desc" },
    });

    let checked = 0;
    let collected = 0;
    const examples = [];

    for (const c of candidates) {
      if (collected >= TARGET_PER_CATEGORY) break;
      checked++;
      let quotes;
      try {
        quotes = await extractOne(cat, c, apiKey);
      } catch (err) {
        console.error(`[${cat.key}] gagal ekstrak ${c.conversationId}: ${err.message}`);
        continue;
      }
      if (!quotes) continue;

      for (const quote of quotes) {
        await prisma.goldStandardExample.create({
          data: {
            category: cat.key,
            quote,
            conversationId: c.conversationId,
            salesName: c.salesName,
            relatedScore: c[cat.scoreColumn],
            sampledFor: c.sampledFor,
          },
        });
      }
      collected++;
      examples.push({ conversationId: c.conversationId, salesName: c.salesName, score: c[cat.scoreColumn], quotes });
      console.log(`[${cat.key}] ${collected}/${TARGET_PER_CATEGORY} — ${c.conversationId} (${c.salesName}, skor ${c[cat.scoreColumn]})`);
    }

    report.push({
      category: cat.key,
      description: cat.description,
      legacyDimension: !!cat.legacyDimension,
      totalCandidates: candidates.length,
      candidatesChecked: checked,
      collected,
      examples,
    });
  }

  // Simpan ringkasan JSON + markdown utk ditinjau manual — TIDAK ditulis ke
  // sistem/fitur lain apa pun, murni dokumen.
  const outDir = path.join(__dirname, "..", "..", "docs", "gold-standard");
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, "gold-standard-examples.json");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  const md = ["# Gold-Standard Examples — Referensi Chatbot Oktober", "", `Diekstrak: ${new Date().toISOString()}`, ""];
  for (const cat of report) {
    md.push(`## ${cat.category}${cat.legacyDimension ? " *(sumber: dimensi legacy)*" : ""}`);
    md.push("");
    md.push(cat.description);
    md.push("");
    md.push(`Kandidat tersedia: ${cat.totalCandidates} · diperiksa: ${cat.candidatesChecked} · terkumpul: ${cat.collected}`);
    md.push("");
    if (cat.examples.length === 0) {
      md.push("**Tidak ada contoh yang lolos ekstraksi.**");
    } else {
      for (const ex of cat.examples) {
        md.push(`- **${ex.salesName}** (conversationId: \`${ex.conversationId}\`, skor: ${ex.score})`);
        for (const q of ex.quotes) md.push(`  > "${q}"`);
      }
    }
    md.push("");
  }
  const mdPath = path.join(outDir, "gold-standard-examples.md");
  fs.writeFileSync(mdPath, md.join("\n"));

  console.log("\n=== RINGKASAN ===");
  for (const cat of report) {
    console.log(`${cat.category}: ${cat.collected}/${TARGET_PER_CATEGORY} (dari ${cat.candidatesChecked}/${cat.totalCandidates} kandidat diperiksa)`);
  }
  console.log(`\nDokumen: ${jsonPath}\n          ${mdPath}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
