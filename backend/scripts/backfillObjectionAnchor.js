// ═══ BACKFILL objectionType + re-anchor akuiPresent/galiPresent utk 72 baris
// PRA-FASE-1 (28 Agustus 2026) ═════════════════════════════════════════════
// Satu-off — TIDAK didaftarkan sbg cron job. Jalankan manual:
//   docker compose exec backend node scripts/backfillObjectionAnchor.js
//
// LATAR BELAKANG: investigasi gold-standard menemukan 72 dari 105 baris hasil
// backfillAkuiGali.js (baris yg dibuat SEBELUM field objectionType ada di
// rubrik) tidak pernah punya jangkar objectionTypeQuote sama sekali —
// extractAkuiGali() jalan TANPA anchor (balik ke scan SELURUH transkrip,
// akar masalah yang investigasi ini mau selesaikan). Test manual thd 5
// transkrip (scripts/testObjectionAnchor.js) menunjukkan ekstraksi
// objectionType baru + re-anchor menghasilkan koreksi yang benar (3/5 false
// positive lama terkoreksi jadi false, 2/5 refinement valid) — 0 regresi.
// Sudah dikonfirmasi ke owner sebelum backfill penuh ini dijalankan.
//
// Script ini, per baris: (1) extractObjectionType() → isi objectionType/
// objectionTypeQuote yang SEBELUMNYA null, (2) extractAkuiGali() dgn anchor
// baru itu → timpa akuiPresent/galiPresent lama yang unanchored. TIDAK
// menyentuh objectionHandlingScore/Quote/Strength/Weakness sama sekali.
import { prisma } from "../src/db.js";
import { fetchTranscriptMessages, formatTranscript, resolveApiKey, extractObjectionType, extractAkuiGali } from "../src/services/qualityScorer/grading.js";
import { estimateCostUsd } from "../src/services/qualityScorer/pricing.js";

async function reExtract(conversationId, apiKey) {
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { customer: { select: { name: true } } },
  });
  if (!conv) return null;
  const messages = await fetchTranscriptMessages(conversationId, new Date());
  if (messages.length === 0) return null;
  const transcriptText = formatTranscript(messages, conv.customer?.name);

  const objResult = await extractObjectionType({ transcriptText, apiKey });
  const akuiGaliResult = await extractAkuiGali({ transcriptText, apiKey, objectionQuote: objResult.objectionTypeQuote });
  const frameworkFollowed = akuiGaliResult.akuiPresent == null || akuiGaliResult.galiPresent == null
    ? null
    : akuiGaliResult.akuiPresent && akuiGaliResult.galiPresent;

  const usage = {
    inputTokens: (objResult.usage.inputTokens || 0) + (akuiGaliResult.usage.inputTokens || 0),
    outputTokens: (objResult.usage.outputTokens || 0) + (akuiGaliResult.usage.outputTokens || 0),
    cacheReadTokens: (objResult.usage.cacheReadTokens || 0) + (akuiGaliResult.usage.cacheReadTokens || 0),
    cacheCreateTokens: (objResult.usage.cacheCreateTokens || 0) + (akuiGaliResult.usage.cacheCreateTokens || 0),
  };

  return {
    objectionType: objResult.objectionType,
    objectionTypeQuote: objResult.objectionTypeQuote,
    akuiPresent: akuiGaliResult.akuiPresent,
    akuiPresentQuote: akuiGaliResult.akuiPresentQuote,
    galiPresent: akuiGaliResult.galiPresent,
    galiPresentQuote: akuiGaliResult.galiPresentQuote,
    frameworkFollowed,
    usage,
  };
}

async function main() {
  const apiKey = resolveApiKey();

  const rows = await prisma.conversationQualityScore.findMany({
    where: { objectionHandlingScore: { not: null }, objectionTypeQuote: null },
    select: {
      id: true, conversationId: true, salesName: true,
      akuiPresent: true, galiPresent: true, frameworkFollowed: true,
    },
    orderBy: { createdAt: "asc" },
  });

  console.log(`Total baris utk backfill (unanchored): ${rows.length}`);

  let ok = 0, failed = 0;
  let totalCostUsd = 0;
  let totalInputTokens = 0, totalOutputTokens = 0;
  const akuiFlips = { trueToFalse: {}, falseToTrue: {} };
  const galiFlips = { trueToFalse: {}, falseToTrue: {} };
  let objectionTypeFilled = 0, objectionTypeStillNull = 0;

  for (const row of rows) {
    let extracted;
    try {
      extracted = await reExtract(row.conversationId, apiKey);
    } catch (err) {
      console.error(`[${row.conversationId}] GAGAL — ${err.message}`);
      failed++;
      continue;
    }
    if (!extracted) {
      console.log(`[${row.conversationId}] SKIP — transkrip/tool call tidak tersedia`);
      failed++;
      continue;
    }

    await prisma.conversationQualityScore.update({
      where: { id: row.id },
      data: {
        objectionType: extracted.objectionType,
        objectionTypeQuote: extracted.objectionTypeQuote,
        akuiPresent: extracted.akuiPresent,
        akuiPresentQuote: extracted.akuiPresentQuote,
        galiPresent: extracted.galiPresent,
        galiPresentQuote: extracted.galiPresentQuote,
        frameworkFollowed: extracted.frameworkFollowed,
        frameworkFollowedQuote: null,
      },
    });
    ok++;
    const rowCost = estimateCostUsd(extracted.usage);
    totalCostUsd += rowCost;
    totalInputTokens += extracted.usage.inputTokens || 0;
    totalOutputTokens += extracted.usage.outputTokens || 0;

    if (extracted.objectionType) objectionTypeFilled++;
    else objectionTypeStillNull++;

    if (row.akuiPresent === true && extracted.akuiPresent === false) akuiFlips.trueToFalse[row.salesName] = (akuiFlips.trueToFalse[row.salesName] || 0) + 1;
    if (row.akuiPresent === false && extracted.akuiPresent === true) akuiFlips.falseToTrue[row.salesName] = (akuiFlips.falseToTrue[row.salesName] || 0) + 1;
    if (row.galiPresent === true && extracted.galiPresent === false) galiFlips.trueToFalse[row.salesName] = (galiFlips.trueToFalse[row.salesName] || 0) + 1;
    if (row.galiPresent === false && extracted.galiPresent === true) galiFlips.falseToTrue[row.salesName] = (galiFlips.falseToTrue[row.salesName] || 0) + 1;

    console.log(`[${row.conversationId}] ${row.salesName}: objectionType=${extracted.objectionType} | akui ${row.akuiPresent}->${extracted.akuiPresent} | gali ${row.galiPresent}->${extracted.galiPresent}`);
  }

  console.log("\n=== RINGKASAN BACKFILL OBJECTION ANCHOR ===");
  console.log(`Berhasil: ${ok}, Gagal/skip: ${failed}`);
  console.log(`objectionType terisi (keberatan ditemukan): ${objectionTypeFilled}, tetap null (tidak ada keberatan di transkrip): ${objectionTypeStillNull}`);
  console.log(`Biaya AKTUAL (Haiku, 3 panggilan/baris): $${totalCostUsd.toFixed(4)} (in=${totalInputTokens} out=${totalOutputTokens} token, ${ok} baris — rata2 $${(totalCostUsd / (ok || 1)).toFixed(5)}/baris)`);
  console.log("\nakuiPresent true->false per sales:");
  console.log(JSON.stringify(akuiFlips.trueToFalse, null, 2));
  console.log("akuiPresent false->true per sales:");
  console.log(JSON.stringify(akuiFlips.falseToTrue, null, 2));
  console.log("\ngaliPresent true->false per sales:");
  console.log(JSON.stringify(galiFlips.trueToFalse, null, 2));
  console.log("galiPresent false->true per sales:");
  console.log(JSON.stringify(galiFlips.falseToTrue, null, 2));

  process.exit(0);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
