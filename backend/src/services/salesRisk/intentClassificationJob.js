// ═══ SALES RISK ENGINE — job klasifikasi intent (harian) ══════════════════
// Mengisi SalesRiskIntentClassification supaya /api/sales-risk BISA baca
// cache tanpa panggil LLM tiap page load (ticket eksplisit minta ini).
//
// EKSPLORASI SEBELUM DESAIN (29 Agustus 2026, sesuai instruksi ticket): Sales
// Risk Engine TERNYATA tidak punya cron sama sekali — /api/sales-risk selalu
// on-demand, computeAllSalesRisks() dihitung LIVE tiap request (dikonfirmasi
// baca src/index.js — tidak ada import/schedule apa pun utk salesRisk/).
// Ticket berasumsi "cron yang sudah ada" — asumsi itu SALAH, jadi job ini
// BARU dibuat, mengikuti pola PERSIS staleLeadAlertJob.js/qualityScorer/job.js
// (cron + persist ke tabel + baca dari tabel di route).
//
// Jadwal 05:00 WIB — slot kosong (02:00 reconciliation, 03:00 quality
// scorer, 04:00 Senin weekly narrative, 08:00 stale-lead-alert).
import cron from "node-cron";
import { prisma } from "../../db.js";
import { loadSalesRiskCandidates, DEFAULT_CANDIDATE_LIMIT } from "./index.js";
import { flattenMessagesAsc } from "./signals.js";
import { classifyLatestMessageIntent, resolveSalesRiskIntentApiKey } from "./intentClassification.js";
import { estimateCostUsd } from "../qualityScorer/pricing.js"; // price table Haiku, model-agnostic — REUSE, bukan duplikasi

/**
 * @param {{limit?: number, candidateLimit?: number}} opts - `limit` membatasi
 *   BERAPA BANYAK customer yang benar-benar diklasifikasi ulang (utk test
 *   skala kecil sebelum backfill penuh — stop condition ticket). `candidateLimit`
 *   membatasi jumlah kandidat yang DIMUAT dari DB (beda concern).
 */
export async function runSalesRiskIntentClassificationJob({ limit = Infinity, candidateLimit = DEFAULT_CANDIDATE_LIMIT } = {}) {
  const apiKey = resolveSalesRiskIntentApiKey();
  const candidates = await loadSalesRiskCandidates(prisma, { limit: candidateLimit });
  const existingCache = await prisma.salesRiskIntentClassification.findMany();
  const cacheByCustomer = new Map(existingCache.map((c) => [c.customerId, c]));

  let classified = 0, skippedCacheValid = 0, skippedNoMessage = 0, failed = 0;
  let totalCostUsd = 0;
  let totalInputTokens = 0, totalOutputTokens = 0;
  const results = []; // { customerId, customerName, before, after, quote } — utk laporan/test

  for (const customer of candidates) {
    if (classified >= limit) break; // stop condition test-kecil-dulu

    const messagesAsc = flattenMessagesAsc(customer.conversations);
    const recentInbound = messagesAsc.filter((m) => m.direction === "INBOUND").slice(-5);
    if (recentInbound.length === 0) { skippedNoMessage++; continue; }

    const lastMsg = recentInbound[recentInbound.length - 1];
    const lastMsgAt = new Date(lastMsg.createdAt);
    const cached = cacheByCustomer.get(customer.id);
    const cacheStillValid = cached && cached.latestMessageAt.getTime() === lastMsgAt.getTime();
    if (cacheStillValid) { skippedCacheValid++; continue; }

    try {
      const { intent, usage } = await classifyLatestMessageIntent({ recentInbound, apiKey });
      await prisma.salesRiskIntentClassification.upsert({
        where: { customerId: customer.id },
        create: { customerId: customer.id, latestMessageIntent: intent, latestMessageAt: lastMsgAt },
        update: { latestMessageIntent: intent, latestMessageAt: lastMsgAt, classifiedAt: new Date() },
      });
      classified++;
      totalCostUsd += estimateCostUsd(usage);
      totalInputTokens += usage.inputTokens || 0;
      totalOutputTokens += usage.outputTokens || 0;
      results.push({
        customerId: customer.id,
        customerName: customer.name || customer.phone || "(tanpa nama)",
        before: cached?.latestMessageIntent ?? null,
        after: intent,
        quote: lastMsg.content,
      });
    } catch (err) {
      failed++;
      console.error(`[sales-risk-intent] Gagal klasifikasi ${customer.id}:`, err.message);
    }
  }

  const summary = {
    candidatesScanned: candidates.length,
    classified, skippedCacheValid, skippedNoMessage, failed,
    totalCostUsd, totalInputTokens, totalOutputTokens,
    results,
  };
  console.log(
    `[sales-risk-intent] Selesai. Diklasifikasi: ${classified}, cache valid (dilewati): ${skippedCacheValid}, ` +
    `tanpa pesan: ${skippedNoMessage}, gagal: ${failed}, biaya: $${totalCostUsd.toFixed(4)}`
  );
  return summary;
}

export function startSalesRiskIntentClassificationJob() {
  cron.schedule("0 5 * * *", async () => {
    console.log("[sales-risk-intent] Cron fired — jam 5 pagi WIB");
    await runSalesRiskIntentClassificationJob().catch((err) => console.error("[sales-risk-intent] Job gagal:", err));
  }, { timezone: "Asia/Jakarta" });
  console.log("[sales-risk-intent] Job terdaftar — jadwal 05:00 WIB");
}
