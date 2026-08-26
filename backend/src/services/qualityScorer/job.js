// ═══ JOB HARIAN — AI Conversation Quality Scorer ═════════════════════════
// Sampling → transcript+mask → grading LLM → simpan ConversationQualityScore.
// Export runQualityScorerJob() TERPISAH dari startQualityScorerJob() —
// pola sama dengan services/slaAlertJob.js — supaya bisa dipicu manual saat
// testing/verifikasi TANPA menunggu jadwal cron (mis. dari script/route
// admin), dan supaya cron scheduling bisa diaktifkan/nonaktifkan terpisah
// dari logic job itu sendiri.
import cron from "node-cron";
import { prisma } from "../../db.js";
import {
  QUALITY_SCORER_MODEL, SAMPLE_SIZE_PER_SALES, MAX_DAILY_LLM_CALLS,
} from "../../config/qualityScorerRubric.js";
import { getActiveSalesUsers, sampleConversationsForSales, yesterdayRangeWIB } from "./sampling.js";
import { fetchTranscriptMessages, formatTranscript, gradeTranscript, resolveApiKey, buildSystemPrompt } from "./grading.js";

// Estimasi harga Claude Haiku 4.5 per 26 Agustus 2026 (USD per 1 JUTA
// token) — dipakai HANYA untuk kolom costUsd di baris log, BUKAN tagihan
// resmi. Cek harga aktual di halaman pricing Anthropic kalau butuh angka
// pasti; harga model bisa berubah tanpa mengubah kode ini.
const PRICE_PER_MTOK_USD = { input: 1.0, output: 5.0, cacheRead: 0.1 };

function estimateCostUsd(usage) {
  const input = (usage.inputTokens || 0) / 1_000_000 * PRICE_PER_MTOK_USD.input;
  const output = (usage.outputTokens || 0) / 1_000_000 * PRICE_PER_MTOK_USD.output;
  const cacheRead = (usage.cacheReadTokens || 0) / 1_000_000 * PRICE_PER_MTOK_USD.cacheRead;
  return Math.round((input + output + cacheRead) * 1_000_000) / 1_000_000;
}

function dimResult(scores, key) {
  const d = scores?.[key];
  if (!d || d.score == null) return { score: null, quote: null, note: d?.note ?? null };
  return { score: Number(d.score), quote: d.quote ?? null, note: d.note ?? null };
}

/**
 * Jalankan satu batch scoring. `referenceNow` cuma untuk keperluan test
 * (override "sekarang" supaya bisa simulasikan hari lain) — default hari
 * ini (WIB), yang berarti "kemarin" = hari sebelum job ini jalan.
 */
export async function runQualityScorerJob({ referenceNow = new Date(), sampleSize = SAMPLE_SIZE_PER_SALES } = {}) {
  const { mulai, selesai } = yesterdayRangeWIB(referenceNow);
  const summary = { sampledFor: mulai, salesProcessed: 0, conversationsGraded: 0, conversationsFailed: 0, totalCostUsd: 0, errors: [] };

  const salesUsers = await getActiveSalesUsers();
  if (salesUsers.length === 0) {
    console.log("[qualityScorer] Tidak ada SALES aktif — job dilewati.");
    return summary;
  }

  let apiKey;
  try {
    apiKey = resolveApiKey();
  } catch (err) {
    console.error("[qualityScorer]", err.message);
    summary.errors.push(err.message);
    return summary;
  }

  // System prompt (rubrik+KB) dibangun SEKALI, dipakai ulang ke SEMUA
  // panggilan batch ini — inilah yang membuat prompt caching Anthropic
  // (ephemeral, lihat services/providers/anthropicProvider.js) benar-benar
  // menghemat: cuma panggilan PERTAMA yang bayar penuh utk bagian ini.
  const systemPrompt = buildSystemPrompt();

  let callsUsed = 0;
  for (const sales of salesUsers) {
    if (callsUsed >= MAX_DAILY_LLM_CALLS) {
      console.warn(`[qualityScorer] MAX_DAILY_LLM_CALLS (${MAX_DAILY_LLM_CALLS}) tercapai — sisa sales dilewati.`);
      break;
    }
    summary.salesProcessed++;
    const remainingBudget = MAX_DAILY_LLM_CALLS - callsUsed;
    const effectiveSampleSize = Math.min(sampleSize, remainingBudget);
    if (effectiveSampleSize <= 0) break;

    let sampled;
    try {
      sampled = await sampleConversationsForSales(sales.id, { mulai, selesai, sampleSize: effectiveSampleSize });
    } catch (err) {
      console.error(`[qualityScorer] Gagal sampling utk ${sales.name}:`, err.message);
      summary.errors.push(`sampling ${sales.name}: ${err.message}`);
      continue;
    }

    for (const row of sampled) {
      callsUsed++;
      try {
        const messages = await fetchTranscriptMessages(row.conversationId, selesai);
        if (messages.length === 0) continue; // percakapan kosong, tidak layak dinilai
        const transcriptText = formatTranscript(messages, row.customerName);

        const { scores, usage } = await gradeTranscript({ systemPrompt, transcriptText, apiKey });
        const costUsd = estimateCostUsd(usage);
        summary.totalCostUsd += costUsd;

        const pk = dimResult(scores, "productKnowledge");
        const cp = dimResult(scores, "consultationProcess");
        const hi = dimResult(scores, "healthImpact");
        const oh = dimResult(scores, "objectionHandling");

        await prisma.conversationQualityScore.upsert({
          where: { conversationId_sampledFor: { conversationId: row.conversationId, sampledFor: mulai } },
          create: {
            conversationId: row.conversationId,
            customerId: row.customerId,
            salesUserId: sales.id,
            salesName: sales.name,
            pipelineStageAtSample: row.pipelineStage,
            sampledFor: mulai,
            productKnowledgeScore: pk.score, productKnowledgeQuote: pk.quote, productKnowledgeNote: pk.note,
            consultationProcessScore: cp.score, consultationProcessQuote: cp.quote, consultationProcessNote: cp.note,
            healthImpactScore: hi.score, healthImpactQuote: hi.quote, healthImpactNote: hi.note,
            objectionHandlingScore: oh.score, objectionHandlingQuote: oh.quote, objectionHandlingNote: oh.note,
            overallNote: scores?.overallNote ?? null,
            model: QUALITY_SCORER_MODEL,
            inputTokens: usage.inputTokens || 0,
            outputTokens: usage.outputTokens || 0,
            costUsd,
            messageCount: messages.length,
          },
          update: {}, // sudah pernah dinilai utk hari ini — jangan timpa (idempotent kalau job dijalankan ulang)
        });
        summary.conversationsGraded++;
      } catch (err) {
        console.error(`[qualityScorer] Gagal nilai percakapan ${row.conversationId}:`, err.message);
        summary.conversationsFailed++;
        summary.errors.push(`conversation ${row.conversationId}: ${err.message}`);
      }
    }
  }

  console.log(
    `[qualityScorer] Selesai. Sales diproses: ${summary.salesProcessed}, percakapan dinilai: ${summary.conversationsGraded}, gagal: ${summary.conversationsFailed}, estimasi biaya: $${summary.totalCostUsd.toFixed(4)}`
  );
  return summary;
}

// Jam 3 pagi WIB — setelah reconciliation (jam 2 pagi) supaya tidak
// berebut beban I/O database di jam yang sama.
export function startQualityScorerJob() {
  cron.schedule("0 3 * * *", async () => {
    console.log("[qualityScorer] Cron fired — jam 3 pagi WIB");
    await runQualityScorerJob();
  }, { timezone: "Asia/Jakarta" });
  console.log("[qualityScorer] Job terdaftar — jalan setiap hari jam 03:00 WIB");
}
