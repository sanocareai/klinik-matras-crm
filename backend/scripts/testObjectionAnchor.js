// ═══ TEST — ekstraksi objectionType baru + re-anchor akui/gali (28 Agustus
// 2026) ═════════════════════════════════════════════════════════════════
// Satu-off, TIDAK menyentuh DB. Jalankan manual:
//   docker compose exec backend node scripts/testObjectionAnchor.js
//
// Test 5 baris UNANCHORED (pra-Fase-1) yang sudah di-spot-check manual thd
// raw transcript sebelumnya, supaya hasil ekstraksi baru bisa dibandingkan
// LANGSUNG dgn penilaian manual yang sudah ada:
//   - Risel  (score=5): sebelumnya FALSE POSITIVE jelas (reassurance garansi
//     generik di akhir percakapan, tidak terkait keberatan apa pun)
//   - Fadlan (score=5): sebelumnya BENAR meski tanpa anchor (keberatan harga
//     eksplisit "servis kok lebih mahal dari beli", jawaban tepat sasaran)
//   - Ervina (score=5): sebelumnya BORDERLINE (on-topic soal firmness, tapi
//     ambigu lolos/gagal uji hapus-frasa)
//   - Fadlan (score=4) & Ervina (score=4): belum pernah di-spot-check manual
import { prisma } from "../src/db.js";
import { fetchTranscriptMessages, formatTranscript, resolveApiKey, extractObjectionType, extractAkuiGali } from "../src/services/qualityScorer/grading.js";
import { estimateCostUsd } from "../src/services/qualityScorer/pricing.js";

const TEST_CONVERSATION_IDS = [
  "cmssmfoz4asut11dhvtd9nsj8", // Risel, score 5 — FALSE POSITIVE lama
  "cmsv49jll7qutv9wuqnn9diez", // Fadlan, score 5 — BENAR lama
  "cmt3r05qd2fkyt2xon5ka06n4", // Ervina, score 5 — BORDERLINE lama
  "cmsvmh7em11dp8cyx44irzrr3", // Fadlan, score 4 — belum dicek
  "cms49yqxx6o3y1e15nqfmy5kn", // Ervina, score 4 — belum dicek
];

async function main() {
  const apiKey = resolveApiKey();
  let totalCostUsd = 0;

  for (const conversationId of TEST_CONVERSATION_IDS) {
    const row = await prisma.conversationQualityScore.findFirst({
      where: { conversationId },
      select: {
        salesName: true, objectionHandlingScore: true,
        akuiPresent: true, akuiPresentQuote: true,
        galiPresent: true, galiPresentQuote: true,
      },
    });
    const conv = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { customer: { select: { name: true } } },
    });
    const messages = await fetchTranscriptMessages(conversationId, new Date());
    const transcriptText = formatTranscript(messages, conv.customer?.name);

    const objResult = await extractObjectionType({ transcriptText, apiKey });
    const akuiGaliResult = await extractAkuiGali({ transcriptText, apiKey, objectionQuote: objResult.objectionTypeQuote });

    const rowCost = estimateCostUsd(objResult.usage) + estimateCostUsd(akuiGaliResult.usage);
    totalCostUsd += rowCost;

    console.log(`\n=== [${conversationId}] ${row.salesName} (score=${row.objectionHandlingScore}) ===`);
    console.log(`objectionType BARU: ${objResult.objectionType} — "${objResult.objectionTypeQuote}"`);
    console.log(`--- LAMA (tanpa anchor) ---`);
    console.log(`akuiPresent=${row.akuiPresent} quote="${row.akuiPresentQuote}"`);
    console.log(`galiPresent=${row.galiPresent} quote="${row.galiPresentQuote}"`);
    console.log(`--- BARU (dgn anchor) ---`);
    console.log(`akuiPresent=${akuiGaliResult.akuiPresent} quote="${akuiGaliResult.akuiPresentQuote}"`);
    console.log(`galiPresent=${akuiGaliResult.galiPresent} quote="${akuiGaliResult.galiPresentQuote}"`);
  }

  console.log(`\n=== BIAYA TEST (5 baris, 3 panggilan/baris) ===`);
  console.log(`Total: $${totalCostUsd.toFixed(4)} (rata2 $${(totalCostUsd / TEST_CONVERSATION_IDS.length).toFixed(5)}/baris)`);

  process.exit(0);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
