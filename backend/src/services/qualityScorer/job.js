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
  QUALITY_SCORER_MODEL, SAMPLE_SIZE_PER_SALES, MAX_DAILY_LLM_CALLS, RUBRIC_DIMENSIONS,
} from "../../config/qualityScorerRubric.js";
import { getActiveSalesUsers, sampleConversationsForSales, yesterdayRangeWIB } from "./sampling.js";
import { fetchTranscriptMessages, formatTranscript, gradeTranscript, resolveApiKey, buildSystemPrompt } from "./grading.js";
import { estimateCostUsd } from "./pricing.js";

// true/false/"true"/"false" → boolean; apa pun lainnya (termasuk undefined)
// → null. LLM diinstruksikan kirim boolean JSON asli, tapi jaga-jaga kalau
// keluar sebagai string.
function normalizeFlag(v) {
  if (v === true || v === false) return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return null;
}

// Generik utk SEMUA dimensi (4 lama tanpa flag, 2 baru dengan flag) — dim
// tanpa `flag` menghasilkan `flag: undefined` (tidak ditulis ke DB sama
// sekali oleh caller), PERSIS perilaku sebelum dimensi E/F ditambahkan.
function dimResult(scores, dim) {
  const d = scores?.[dim.key];
  if (!d || d.score == null) {
    return { score: null, quote: null, note: d?.note ?? null, flag: dim.flag ? null : undefined };
  }
  return {
    score: Number(d.score),
    quote: d.quote ?? null,
    note: d.note ?? null,
    flag: dim.flag ? normalizeFlag(d[dim.flag.key]) : undefined,
  };
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

        // Dibangun generik dari RUBRIC_DIMENSIONS (6 dimensi) — utk 4
        // dimensi lama menghasilkan field {key}Score/{key}Quote/{key}Note
        // PERSIS sama seperti sebelumnya (cuma cara menulisnya yang
        // digeneralisasi, bukan nilainya). 2 dimensi baru menambah field
        // flag booleannya sendiri (closingAskPresent/plainLanguageUsed).
        const dimFields = {};
        for (const dim of RUBRIC_DIMENSIONS) {
          const r = dimResult(scores, dim);
          dimFields[`${dim.key}Score`] = r.score;
          dimFields[`${dim.key}Quote`] = r.quote;
          dimFields[`${dim.key}Note`] = r.note;
          if (dim.flag) dimFields[dim.flag.key] = r.flag;
        }

        await prisma.conversationQualityScore.upsert({
          where: { conversationId_sampledFor: { conversationId: row.conversationId, sampledFor: mulai } },
          create: {
            conversationId: row.conversationId,
            customerId: row.customerId,
            salesUserId: sales.id,
            salesName: sales.name,
            pipelineStageAtSample: row.pipelineStage,
            sampledFor: mulai,
            ...dimFields,
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
