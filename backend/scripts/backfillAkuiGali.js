// ═══ BACKFILL akuiPresent/galiPresent (28 Agustus 2026) ═══════════════════
// Satu-off — TIDAK didaftarkan sbg cron job. Jalankan manual:
//   docker compose exec backend node scripts/backfillAkuiGali.js
//
// LATAR BELAKANG: frameworkFollowed lama (1 boolean gabungan utk Dengar-
// Akui-Gali) ke-satisfy oleh basa-basi rutin ("baik kak") yang muncul
// identik di banyak tempat lain pada transkrip yang sama — ditemukan lewat
// investigasi gold-standard (baca 3 transkrip mentah). Rubrik sekarang
// menilai akuiPresent & galiPresent TERPISAH dgn instruksi lebih ketat
// (qualityScorerRubric.js). Script ini RE-EXTRACT KEDUA field itu SAJA utk
// SEMUA baris ConversationQualityScore yang objectionHandlingScore-nya
// terisi — TIDAK menyentuh score/quote/strength/weakness/objectionType
// dimensi itu, TIDAK menyentuh dimensi lain sama sekali (communicationSkill/
// authoritySelling/evidenceBasedSelling apa adanya).
//
// Pakai buildExtraFieldsTool()/buildExtraFieldsPrompt() (qualityScorerRubric.js)
// — SAMA PERSIS definisi/instruksi dgn yang dipakai job grading harian,
// supaya kriteria backfill data lama identik dgn kriteria grading baru
// (tidak ada drift).
import { prisma } from "../src/db.js";
import { fetchTranscriptMessages, formatTranscript, resolveApiKey } from "../src/services/qualityScorer/grading.js";
import { chatWithTools } from "../src/services/providers/anthropicProvider.js";
import { QUALITY_SCORER_MODEL, RUBRIC_DIMENSIONS, buildExtraFieldsTool, buildExtraFieldsPrompt } from "../src/config/qualityScorerRubric.js";

const OBJECTION_HANDLING = RUBRIC_DIMENSIONS.find((d) => d.key === "objectionHandling");

function normalizeFlag(v) {
  if (v === true || v === false) return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return null;
}

async function reExtract(conversationId, apiKey, systemPrompt, tool) {
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { customer: { select: { name: true } } },
  });
  if (!conv) return null;
  const messages = await fetchTranscriptMessages(conversationId, new Date());
  if (messages.length === 0) return null;
  const transcriptText = formatTranscript(messages, conv.customer?.name);

  const { toolCalls } = await chatWithTools({
    apiKey,
    model: QUALITY_SCORER_MODEL,
    systemPrompt,
    messages: [{ role: "user", content: `Transkrip:\n\n${transcriptText}` }],
    tools: [tool],
    toolChoice: { type: "tool", name: tool.name },
    maxTokens: 400,
  });
  const call = toolCalls.find((c) => c.name === tool.name);
  if (!call) return null;

  const akuiPresent = normalizeFlag(call.input.akuiPresent);
  const galiPresent = normalizeFlag(call.input.galiPresent);
  const frameworkFollowed = akuiPresent == null || galiPresent == null ? null : akuiPresent && galiPresent;
  return {
    akuiPresent,
    akuiPresentQuote: call.input.akuiPresentQuote ?? null,
    galiPresent,
    galiPresentQuote: call.input.galiPresentQuote ?? null,
    frameworkFollowed,
  };
}

async function main() {
  const apiKey = resolveApiKey();
  const systemPrompt = buildExtraFieldsPrompt(OBJECTION_HANDLING);
  const tool = buildExtraFieldsTool(OBJECTION_HANDLING);

  const rows = await prisma.conversationQualityScore.findMany({
    where: { objectionHandlingScore: { not: null } },
    select: { id: true, conversationId: true, salesName: true, frameworkFollowed: true },
    orderBy: { createdAt: "asc" },
  });

  console.log(`Total baris utk backfill: ${rows.length}`);

  const changes = []; // { salesName, from, to }
  let ok = 0, failed = 0;

  for (const row of rows) {
    let extracted;
    try {
      extracted = await reExtract(row.conversationId, apiKey, systemPrompt, tool);
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
        akuiPresent: extracted.akuiPresent,
        akuiPresentQuote: extracted.akuiPresentQuote,
        galiPresent: extracted.galiPresent,
        galiPresentQuote: extracted.galiPresentQuote,
        frameworkFollowed: extracted.frameworkFollowed,
        frameworkFollowedQuote: null,
      },
    });
    ok++;

    const before = row.frameworkFollowed;
    const after = extracted.frameworkFollowed;
    if (before !== after) {
      changes.push({ salesName: row.salesName, conversationId: row.conversationId, from: before, to: after });
      console.log(`[${row.conversationId}] ${row.salesName}: frameworkFollowed ${before} -> ${after} (akui=${extracted.akuiPresent}, gali=${extracted.galiPresent})`);
    } else {
      console.log(`[${row.conversationId}] ${row.salesName}: tidak berubah (${before} -> ${after})`);
    }
  }

  // Ringkasan perubahan true->false per sales (yang paling relevan utk
  // laporan — sales yang SEBELUMNYA dianggap patuh framework tapi
  // sebenarnya tidak, setelah kriteria diperketat).
  const trueToFalseBySales = {};
  const falseToTrueBySales = {};
  for (const c of changes) {
    if (c.from === true && c.to === false) trueToFalseBySales[c.salesName] = (trueToFalseBySales[c.salesName] || 0) + 1;
    if (c.from === false && c.to === true) falseToTrueBySales[c.salesName] = (falseToTrueBySales[c.salesName] || 0) + 1;
  }

  console.log("\n=== RINGKASAN BACKFILL ===");
  console.log(`Berhasil: ${ok}, Gagal/skip: ${failed}, Total baris berubah: ${changes.length}`);
  console.log("\nfalse->true per sales (SEBELUMNYA dinilai gagal, TERNYATA memenuhi kriteria baru yang lebih spesifik):");
  console.log(JSON.stringify(falseToTrueBySales, null, 2));
  console.log("\ntrue->false per sales (SEBELUMNYA dianggap patuh framework krn basa-basi, TERNYATA tidak memenuhi kriteria baru):");
  console.log(JSON.stringify(trueToFalseBySales, null, 2));

  process.exit(0);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
