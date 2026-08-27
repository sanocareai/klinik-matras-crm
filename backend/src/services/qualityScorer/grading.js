// ═══ GRADING — AI Conversation Quality Scorer ════════════════════════════
// Ambil transcript satu percakapan → mask data pribadi → kirim ke LLM
// (system prompt = rubrik+KB, di-cache Anthropic; user message = transcript
// PER PERCAKAPAN, tidak di-cache) → parse hasil 4 dimensi.
import { prisma } from "../../db.js";
import { chatWithTools } from "../providers/anthropicProvider.js";
import { getAnthropicKey } from "../replyAssistant/providers/keyStore.js";
import { QUALITY_SCORER_MODEL, buildSystemPrompt, buildDimensionTool, RUBRIC_DIMENSIONS } from "../../config/qualityScorerRubric.js";
import { maskMessageContent } from "./masking.js";

// Cap panjang transcript per percakapan — percakapan lama/aktif bisa
// berbulan-bulan; kita cuma butuh cukup konteks utk menilai wajar, bukan
// seluruh riwayat. 150 pesan generous utk kebanyakan percakapan WA CRM di
// bisnis ini (pola sama dgn MAKS_PESAN_PER_PERCAKAPAN=200 di
// mcp/toolsChat.js#audit_balasan_sales, angka dekat sengaja supaya biaya
// tetap predictable, bukan kebetulan sama persis).
const MAX_MESSAGES_PER_TRANSCRIPT = 150;

/**
 * Ambil transcript (kronologis, INBOUND+OUTBOUND) sampai batas `selesai`,
 * dibatasi MAX_MESSAGES_PER_TRANSCRIPT pesan TERBARU sebelum batas itu
 * (query DESC+take lalu dibalik ke ASC di JS, supaya "150 pesan terakhir"
 * bukan "150 pesan pertama sepanjang sejarah percakapan").
 */
export async function fetchTranscriptMessages(conversationId, selesai) {
  const desc = await prisma.message.findMany({
    where: { conversationId, createdAt: { lt: selesai } },
    orderBy: { createdAt: "desc" },
    take: MAX_MESSAGES_PER_TRANSCRIPT,
    select: { direction: true, content: true, createdAt: true },
  });
  return desc.reverse(); // kembalikan kronologis ASCENDING
}

/**
 * Bangun teks transcript siap-kirim dari daftar Message (urutan kronologis
 * ASCENDING — pemanggil bertanggung jawab urutan query-nya), sudah di-mask
 * (nomor HP/email/nama customer disamarkan) di SETIAP pesan.
 */
export function formatTranscript(messagesAsc, customerName) {
  return messagesAsc
    .map((m) => {
      const speaker = m.direction === "INBOUND" ? "CUSTOMER" : "SALES";
      const masked = maskMessageContent(m.content || "", customerName);
      return `[${speaker}] ${masked}`;
    })
    .join("\n");
}

function addUsage(total, u) {
  total.inputTokens += u.inputTokens || 0;
  total.outputTokens += u.outputTokens || 0;
  total.cacheReadTokens += u.cacheReadTokens || 0;
  total.cacheCreateTokens += u.cacheCreateTokens || 0;
}

/**
 * Panggil LLM untuk menilai satu transcript. `systemPrompt` DIBERIKAN dari
 * pemanggil (bukan dibangun ulang di sini) supaya job.js bisa membangunnya
 * SEKALI per batch dan dipakai ulang ke semua percakapan — itu yang membuat
 * prompt caching Anthropic benar-benar menghemat biaya (system prompt sama
 * persis di seluruh panggilan hari itu).
 *
 * FIX 28 Agustus 2026 (bug JSON-escaping ~5-7% gagal parse) — PERCOBAAN KE-2:
 * percobaan pertama (1 tool call gabungan utk 3 dimensi via tool_choice
 * paksa) di-revert setelah verifikasi live menunjukkan Haiku SERING berhenti
 * generate setelah dimensi pertama saja (~88% gagal pada sampel awal — lebih
 * buruk dari bug asli). Sekarang: 1 tool call TERPISAH PER DIMENSI (skema
 * jauh lebih kecil per panggilan) — lihat catatan lengkap di
 * qualityScorerRubric.js#buildDimensionTool soal kenapa & trade-off biayanya
 * (transcript dikirim ulang tiap panggilan, TIDAK di-cache Anthropic).
 *
 * @returns {{ scores: object, usage: object }}
 */
export async function gradeTranscript({ systemPrompt, transcriptText, apiKey }) {
  const scores = {};
  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0 };
  const userMessage = { role: "user", content: `Nilai transkrip percakapan berikut:\n\n${transcriptText}` };

  for (let i = 0; i < RUBRIC_DIMENSIONS.length; i++) {
    const dim = RUBRIC_DIMENSIONS[i];
    const isLast = i === RUBRIC_DIMENSIONS.length - 1;
    const tool = buildDimensionTool(dim, { includeOverallNote: isLast });

    const { toolCalls, usage: u } = await chatWithTools({
      apiKey,
      model: QUALITY_SCORER_MODEL,
      systemPrompt,
      messages: [userMessage],
      tools: [tool],
      toolChoice: { type: "tool", name: tool.name },
      // 800 cukup generous utk 1 dimensi (score/quote/strength/weakness +
      // maks 2 field tambahan) — jauh di bawah kebutuhan skema gabungan lama
      // (1536 utk 3 dimensi sekaligus).
      maxTokens: 800,
    });
    addUsage(usage, u);

    const call = toolCalls.find((c) => c.name === tool.name);
    if (!call) {
      throw new Error(`Dimensi "${dim.key}": LLM tidak memanggil tool ${tool.name} (kemungkinan output terpotong maxTokens).`);
    }
    const missingKeys = tool.input_schema.required.filter((k) => !(k in call.input));
    if (missingKeys.length) {
      throw new Error(`Dimensi "${dim.key}": tool call tidak lengkap — field hilang: ${missingKeys.join(", ")}.`);
    }

    const { overallNote, ...dimFields } = call.input;
    scores[dim.key] = dimFields;
    if (isLast) scores.overallNote = overallNote ?? null;
  }

  return { scores, usage };
}

export function resolveApiKey() {
  const key = getAnthropicKey();
  if (!key) throw new Error("Tidak ada API key Anthropic aktif di AI Playground (data/ai-models.json) — Quality Scorer butuh key yang sama.");
  return key.apiKey;
}

export { buildSystemPrompt };
