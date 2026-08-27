// ═══ GRADING — AI Conversation Quality Scorer ════════════════════════════
// Ambil transcript satu percakapan → mask data pribadi → kirim ke LLM
// (system prompt = rubrik+KB, di-cache Anthropic; user message = transcript
// PER PERCAKAPAN, tidak di-cache) → parse hasil 4 dimensi.
import { prisma } from "../../db.js";
import { chatWithTools } from "../providers/anthropicProvider.js";
import { getAnthropicKey } from "../replyAssistant/providers/keyStore.js";
import { QUALITY_SCORER_MODEL, buildSystemPrompt, buildRubricTool, RUBRIC_DIMENSIONS } from "../../config/qualityScorerRubric.js";
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
 * FIX 28 Agustus 2026 (bug JSON-escaping ~5-7% gagal parse): dulu minta LLM
 * menulis JSON di teks bebas lalu JSON.parse manual — gagal kalau ada tanda
 * kutip tidak ter-escape di dalam value "quote". Sekarang pakai tool_choice
 * PAKSA (Anthropic native structured output, lihat qualityScorerRubric.js
 * buildRubricTool()) — `input` sudah berupa objek ter-parse dari API, TIDAK
 * ADA lagi JSON.parse manual di sini sama sekali.
 *
 * @returns {{ scores: object, usage: object }}
 */
export async function gradeTranscript({ systemPrompt, transcriptText, apiKey }) {
  const tool = buildRubricTool();
  const { toolCalls, usage } = await chatWithTools({
    apiKey,
    model: QUALITY_SCORER_MODEL,
    systemPrompt,
    messages: [{ role: "user", content: `Nilai transkrip percakapan berikut:\n\n${transcriptText}` }],
    tools: [tool],
    toolChoice: { type: "tool", name: tool.name },
    // 1536 (naik dari 1024, 26 Agustus 2026) — 6 dimensi (tambah Closing
    // Assertiveness & Customer Comprehension, masing2 +field flag boolean)
    // butuh lebih banyak ruang output JSON dibanding 4 dimensi lama, supaya
    // tidak terpotong sebelum JSON selesai.
    maxTokens: 1536,
  });

  const call = toolCalls.find((c) => c.name === tool.name);
  if (!call) {
    throw new Error(`LLM tidak memanggil tool ${tool.name} — tidak ada hasil penilaian (kemungkinan output terpotong maxTokens).`);
  }

  // Verifikasi eksplisit (28 Agustus 2026, ditemukan lewat verifikasi live):
  // `required` di JSON schema tool TIDAK 100% dijamin Anthropic — sesekali
  // tool call kembali dengan sebagian dimensi hilang total dari objeknya
  // (bukan cuma score:null, tapi KEY-nya sendiri tidak ada), padahal
  // stop_reason="tool_use" (bukan terpotong maxTokens). Kalau dibiarkan,
  // dimResult() di job.js akan menganggap dimensi itu "topik tidak muncul"
  // (semua null) — silently mengarang data, bukan gagal kelihatan. Cek
  // eksplisit ini mengubahnya jadi error yang tercatat di summary.errors,
  // konsisten dgn perilaku lama (gagal parse JSON) yang juga surfaced.
  const missingDims = RUBRIC_DIMENSIONS.filter((d) => !(d.key in call.input));
  if (missingDims.length) {
    throw new Error(
      `Tool call tidak lengkap — dimensi hilang dari hasil: ${missingDims.map((d) => d.key).join(", ")}.`
    );
  }

  return { scores: call.input, usage };
}

export function resolveApiKey() {
  const key = getAnthropicKey();
  if (!key) throw new Error("Tidak ada API key Anthropic aktif di AI Playground (data/ai-models.json) — Quality Scorer butuh key yang sama.");
  return key.apiKey;
}

export { buildSystemPrompt };
