// ═══ BACKFILL authority* granular fields (28 Agustus 2026) ════════════════
// Satu-off — TIDAK didaftarkan sbg cron job. Jalankan manual:
//   docker compose exec backend node scripts/backfillAuthorityStructure.js
//
// LATAR BELAKANG: cross-check status Fase 3 (Evidence-Based Selling) menemukan
// authorityStructureFollowed SUDAH live sejak 27 Agustus sbg 1 boolean
// gabungan utk 4 langkah Struktur Authority Communication — persis pola
// frameworkFollowed lama yang terbukti bermasalah di objectionHandling.
// Dipecah jadi 4 kolom granular (authorityReferensiPresent/HedgeLanguageUsed/
// MekanismeExplained/SolusiConnected) SEBELUM sempat dipakai lama (baru 27
// baris terisi) — lihat qualityScorerRubric.js#evidenceBasedSelling utk
// definisi lengkap tiap field.
//
// Script ini RE-EKSTRAK dimensi evidenceBasedSelling UTUH (score/quote/
// quote2/strength/weakness/evidenceUsed/evidenceExplained/storySellingUsed/
// 4 field authority baru) via extractEvidenceBasedSelling() — SAMA PERSIS
// tool/prompt yang dipakai grading harian, 1 sumber kebenaran. Field dimensi
// LAIN (Communication Skill/Authority Selling/Objection Handling/akui-gali)
// SAMA SEKALI TIDAK DISENTUH — update Prisma cuma berisi kolom
// evidenceBasedSelling*/authority*/evidenceUsed/evidenceExplained/
// storySellingUsed.
//
// CATATAN JUJUR: karena semua field ini 1 tool call gabungan (bukan
// dipisah spt akui/gali), score/quote/strength/weakness dimensi ini BISA
// bergeser sedikit dibanding nilai lama akibat non-determinisme LLM —
// bukan karena kriteria dimensi ini sengaja diubah, murni efek samping
// re-generate satu tool call yang sama.
import { prisma } from "../src/db.js";
import { fetchTranscriptMessages, formatTranscript, resolveApiKey, extractEvidenceBasedSelling } from "../src/services/qualityScorer/grading.js";
import { dimResult } from "../src/services/qualityScorer/job.js";
import { RUBRIC_DIMENSIONS } from "../src/config/qualityScorerRubric.js";
import { estimateCostUsd } from "../src/services/qualityScorer/pricing.js";

const DIM = RUBRIC_DIMENSIONS.find((d) => d.key === "evidenceBasedSelling");

async function reExtract(conversationId, apiKey) {
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { customer: { select: { name: true } } },
  });
  if (!conv) return null;
  const messages = await fetchTranscriptMessages(conversationId, new Date());
  if (messages.length === 0) return null;
  const transcriptText = formatTranscript(messages, conv.customer?.name);

  const { dimFields, usage } = await extractEvidenceBasedSelling({ transcriptText, apiKey });
  const r = dimResult({ evidenceBasedSelling: dimFields }, DIM);

  return {
    data: {
      evidenceBasedSellingScore: r.score,
      evidenceBasedSellingQuote: r.quote,
      evidenceBasedSellingQuote2: r.quote2,
      evidenceBasedSellingStrength: r.strength,
      evidenceBasedSellingWeakness: r.weakness,
      evidenceUsed: r.evidenceUsed,
      evidenceExplained: r.evidenceExplained,
      storySellingUsed: r.storySellingUsed,
      authorityReferensiPresent: r.authorityReferensiPresent,
      authorityHedgeLanguageUsed: r.authorityHedgeLanguageUsed,
      authorityMekanismeExplained: r.authorityMekanismeExplained,
      authoritySolusiConnected: r.authoritySolusiConnected,
      authorityStructureFollowed: r.authorityStructureFollowed,
    },
    usage,
  };
}

async function main() {
  const apiKey = resolveApiKey();

  const rows = await prisma.conversationQualityScore.findMany({
    where: { evidenceBasedSellingScore: { not: null } },
    select: { id: true, conversationId: true, salesName: true },
    orderBy: { createdAt: "asc" },
  });

  console.log(`Total baris utk backfill: ${rows.length}`);

  let ok = 0, failed = 0;
  let totalCostUsd = 0;
  let totalInputTokens = 0, totalOutputTokens = 0;
  const perSales = {}; // salesName -> { referensi:0, hedge:0, mekanisme:0, solusi:0 } jumlah true

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
      console.log(`[${row.conversationId}] SKIP — transkrip tidak tersedia`);
      failed++;
      continue;
    }

    await prisma.conversationQualityScore.update({ where: { id: row.id }, data: extracted.data });
    ok++;
    totalCostUsd += estimateCostUsd(extracted.usage);
    totalInputTokens += extracted.usage.inputTokens || 0;
    totalOutputTokens += extracted.usage.outputTokens || 0;

    const s = row.salesName;
    if (!perSales[s]) perSales[s] = { referensi: 0, hedge: 0, mekanisme: 0, solusi: 0 };
    if (extracted.data.authorityReferensiPresent) perSales[s].referensi++;
    if (extracted.data.authorityHedgeLanguageUsed) perSales[s].hedge++;
    if (extracted.data.authorityMekanismeExplained) perSales[s].mekanisme++;
    if (extracted.data.authoritySolusiConnected) perSales[s].solusi++;

    console.log(`[${row.conversationId}] ${row.salesName}: referensi=${extracted.data.authorityReferensiPresent} hedge=${extracted.data.authorityHedgeLanguageUsed} mekanisme=${extracted.data.authorityMekanismeExplained} solusi=${extracted.data.authoritySolusiConnected} => authorityStructureFollowed=${extracted.data.authorityStructureFollowed}`);
  }

  console.log("\n=== RINGKASAN BACKFILL AUTHORITY STRUCTURE ===");
  console.log(`Berhasil: ${ok}, Gagal/skip: ${failed}`);
  console.log(`Biaya AKTUAL: $${totalCostUsd.toFixed(4)} (in=${totalInputTokens} out=${totalOutputTokens} token, ${ok} baris — rata2 $${(totalCostUsd / (ok || 1)).toFixed(5)}/baris)`);
  console.log("\nJumlah true per langkah, per sales:");
  console.log(JSON.stringify(perSales, null, 2));

  process.exit(0);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
