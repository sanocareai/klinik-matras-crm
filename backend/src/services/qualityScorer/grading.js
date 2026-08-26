// ═══ GRADING — AI Conversation Quality Scorer ════════════════════════════
// Ambil transcript satu percakapan → mask data pribadi → kirim ke LLM
// (system prompt = rubrik+KB, di-cache Anthropic; user message = transcript
// PER PERCAKAPAN, tidak di-cache) → parse hasil 4 dimensi.
import { prisma } from "../../db.js";
import { chat } from "../providers/anthropicProvider.js";
import { getAnthropicKey } from "../replyAssistant/providers/keyStore.js";
import { QUALITY_SCORER_MODEL, buildSystemPrompt } from "../../config/qualityScorerRubric.js";
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

/**
 * Panggil LLM untuk menilai satu transcript. `systemPrompt` DIBERIKAN dari
 * pemanggil (bukan dibangun ulang di sini) supaya job.js bisa membangunnya
 * SEKALI per batch dan dipakai ulang ke semua percakapan — itu yang membuat
 * prompt caching Anthropic benar-benar menghemat biaya (system prompt sama
 * persis di seluruh panggilan hari itu).
 *
 * @returns {{ scores: object, usage: object, raw: string }}
 */
export async function gradeTranscript({ systemPrompt, transcriptText, apiKey }) {
  const { reply, usage } = await chat({
    apiKey,
    model: QUALITY_SCORER_MODEL,
    systemPrompt,
    messages: [{ role: "user", content: `Nilai transkrip percakapan berikut:\n\n${transcriptText}` }],
    maxTokens: 1024,
  });

  let parsed;
  try {
    // LLM diinstruksikan JSON murni, tapi jaga-jaga kalau ada ```json fence.
    const cleaned = reply.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Gagal parse output LLM sebagai JSON: ${err.message}. Raw: ${reply.slice(0, 300)}`);
  }

  return { scores: parsed, usage, raw: reply };
}

export function resolveApiKey() {
  const key = getAnthropicKey();
  if (!key) throw new Error("Tidak ada API key Anthropic aktif di AI Playground (data/ai-models.json) — Quality Scorer butuh key yang sama.");
  return key.apiKey;
}

export { buildSystemPrompt };
