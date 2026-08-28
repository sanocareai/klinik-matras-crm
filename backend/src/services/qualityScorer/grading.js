// ═══ GRADING — AI Conversation Quality Scorer ════════════════════════════
// Ambil transcript satu percakapan → mask data pribadi → kirim ke LLM
// (system prompt = rubrik+KB, di-cache Anthropic; user message = transcript
// PER PERCAKAPAN, tidak di-cache) → parse hasil 4 dimensi.
import { prisma } from "../../db.js";
import { chatWithTools } from "../providers/anthropicProvider.js";
import { getAnthropicKey } from "../replyAssistant/providers/keyStore.js";
import {
  QUALITY_SCORER_MODEL, buildSystemPrompt, buildDimensionTool, RUBRIC_DIMENSIONS,
  buildGaliTool, buildGaliPrompt, buildAkuiTool, buildAkuiPrompt,
  buildObjectionTypeTool, buildObjectionTypePrompt,
} from "../../config/qualityScorerRubric.js";
import { maskMessageContent } from "./masking.js";

// REVERT (28 Agustus 2026) — Sonnet dicoba KHUSUS akuiPresent/galiPresent,
// diverifikasi live thd 3 transkrip: TIDAK memberi perbaikan sama sekali
// (Case 3 gagal identik dgn Haiku, quote filler yang SAMA PERSIS diterima
// sbg bukti Akui). Kesimpulan: bukan soal kapabilitas model, murni soal
// ketajaman kriteria — kembali ke Haiku (QUALITY_SCORER_MODEL), 3x lebih
// murah, tanpa kompromi hasil. Lihat buildAkuiPrompt() utk heuristik
// "hapus frasa akui, cek apakah pitch tetap utuh" — percobaan berikutnya
// setelah 2-panggilan+jangkar tidak cukup.

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

function normalizeFlag(v) {
  if (v === true || v === false) return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return null;
}

/**
 * akuiPresent/galiPresent — 2 PANGGILAN SEKUENSIAL TERPISAH (28 Agustus
 * 2026, percobaan ke-2 setelah 3 iterasi prompt 1-panggilan gabungan
 * TERBUKTI TIDAK STABIL — lihat catatan lengkap di
 * qualityScorerRubric.js#buildAkuiPrompt). Gali diekstrak DULU, lalu
 * kutipannya (kalau ada) diberikan sbg KONTEKS ke panggilan Akui dengan
 * instruksi eksplisit "cari kalimat LAIN" — non-overlap dijamin lewat
 * STRUKTUR, bukan lewat harapan model mematuhi instruksi teks.
 *
 * Dipakai job grading harian (gradeTranscript, di bawah) MAUPUN
 * scripts/backfillAkuiGali.js — 1 sumber kebenaran, kriteria backfill data
 * lama IDENTIK dgn kriteria grading baru.
 *
 * `objectionQuote` (kutipan keberatan dari objectionType/objectionTypeQuote,
 * SUDAH diekstrak duluan oleh tool call dimensi utama) DITERUSKAN ke KEDUA
 * panggilan sbg jangkar — BUG DITEMUKAN lewat verifikasi live: tanpa
 * jangkar ini, panggilan Gali/Akui bisa menemukan pertanyaan/pengakuan dari
 * BAGIAN LAIN percakapan (mis. pertanyaan diagnosa di AWAL, sebelum ada
 * keberatan sama sekali) dan salah mengiranya sbg respons thd keberatan.
 *
 * @returns {{ akuiPresent, akuiPresentQuote, galiPresent, galiPresentQuote, usage }}
 */
export async function extractAkuiGali({ transcriptText, apiKey, objectionQuote = null }) {
  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0 };
  const userMessage = { role: "user", content: `Transkrip:\n\n${transcriptText}` };

  const galiTool = buildGaliTool();
  const { toolCalls: galiCalls, usage: galiUsage } = await chatWithTools({
    apiKey, model: QUALITY_SCORER_MODEL, systemPrompt: buildGaliPrompt(objectionQuote),
    messages: [userMessage], tools: [galiTool], toolChoice: { type: "tool", name: galiTool.name },
    maxTokens: 300,
  });
  addUsage(usage, galiUsage);
  const galiCall = galiCalls.find((c) => c.name === galiTool.name);
  const galiPresent = galiCall ? normalizeFlag(galiCall.input.galiPresent) : null;
  const galiPresentQuote = galiCall?.input.galiPresentQuote ?? null;

  const akuiTool = buildAkuiTool();
  const { toolCalls: akuiCalls, usage: akuiUsage } = await chatWithTools({
    apiKey, model: QUALITY_SCORER_MODEL, systemPrompt: buildAkuiPrompt(objectionQuote, galiPresent ? galiPresentQuote : null),
    messages: [userMessage], tools: [akuiTool], toolChoice: { type: "tool", name: akuiTool.name },
    maxTokens: 300,
  });
  addUsage(usage, akuiUsage);
  const akuiCall = akuiCalls.find((c) => c.name === akuiTool.name);
  const akuiPresent = akuiCall ? normalizeFlag(akuiCall.input.akuiPresent) : null;
  const akuiPresentQuote = akuiCall?.input.akuiPresentQuote ?? null;

  return { akuiPresent, akuiPresentQuote, galiPresent, galiPresentQuote, usage };
}

/**
 * Ekstraksi objectionType/objectionTypeQuote TERPISAH — khusus baris LAMA
 * (pra-Fase-1) yang tidak pernah punya field ini sama sekali (lihat catatan
 * lengkap di qualityScorerRubric.js#buildObjectionTypePrompt soal kenapa ini
 * perlu ada, TERPISAH dari tool call dimensi utama objectionHandling).
 * TIDAK menyentuh objectionHandlingScore/Quote/Strength/Weakness — panggilan
 * ini SATU-SATUNYA tujuannya menghasilkan jangkar utk extractAkuiGali().
 *
 * @returns {{ objectionType, objectionTypeQuote, usage }}
 */
export async function extractObjectionType({ transcriptText, apiKey }) {
  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0 };
  const userMessage = { role: "user", content: `Transkrip:\n\n${transcriptText}` };

  const tool = buildObjectionTypeTool();
  const { toolCalls, usage: callUsage } = await chatWithTools({
    apiKey, model: QUALITY_SCORER_MODEL, systemPrompt: buildObjectionTypePrompt(),
    messages: [userMessage], tools: [tool], toolChoice: { type: "tool", name: tool.name },
    maxTokens: 300,
  });
  addUsage(usage, callUsage);
  const call = toolCalls.find((c) => c.name === tool.name);
  const objectionType = call?.input.objectionType ?? null;
  const objectionTypeQuote = call?.input.objectionTypeQuote ?? null;

  return { objectionType, objectionTypeQuote, usage };
}

const EVIDENCE_BASED_SELLING_DIM = RUBRIC_DIMENSIONS.find((d) => d.key === "evidenceBasedSelling");

/**
 * Re-ekstrak SATU dimensi (evidenceBasedSelling) saja — dipakai
 * scripts/backfillAuthorityStructure.js utk mengisi 4 field authority*
 * granular yang baru ditambahkan (28 Agustus 2026, pemecahan
 * authorityStructureFollowed) ke baris LAMA yang evidenceBasedSellingScore-nya
 * sudah terisi. SAMA PERSIS tool/prompt yang dipakai gradeTranscript() harian
 * (buildDimensionTool) — 1 sumber kebenaran, tidak ada drift kriteria.
 *
 * @returns {{ dimFields: object, usage: object }}
 */
export async function extractEvidenceBasedSelling({ transcriptText, apiKey }) {
  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0 };
  const userMessage = { role: "user", content: `Nilai transkrip percakapan berikut:\n\n${transcriptText}` };
  const tool = buildDimensionTool(EVIDENCE_BASED_SELLING_DIM, { includeOverallNote: false });

  const { toolCalls, usage: u } = await chatWithTools({
    apiKey, model: QUALITY_SCORER_MODEL, systemPrompt: buildSystemPrompt(),
    messages: [userMessage], tools: [tool], toolChoice: { type: "tool", name: tool.name },
    maxTokens: 800,
  });
  addUsage(usage, u);

  const call = toolCalls.find((c) => c.name === tool.name);
  if (!call) throw new Error(`evidenceBasedSelling: LLM tidak memanggil tool ${tool.name}.`);
  return { dimFields: call.input, usage };
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

    // akuiPresent/galiPresent (28 Agustus 2026) — TIDAK LAGI bagian dari
    // tool call dimensi objectionHandling di atas (lihat qualityScorerRubric.js
    // soal kenapa dipisah jadi 2 panggilan sekuensial terpisah). Jalankan
    // HANYA kalau objectionHandlingScore terisi (ada keberatan terdeteksi) —
    // sama prinsip null-safety dgn extraFields lain, jangan buang 2
    // panggilan LLM utk topik yang tidak muncul di percakapan ini.
    if (dim.key === "objectionHandling" && dimFields.score != null) {
      const akuiGali = await extractAkuiGali({ transcriptText, apiKey, objectionQuote: dimFields.objectionTypeQuote ?? null });
      addUsage(usage, akuiGali.usage);
      scores.objectionHandling.akuiPresent = akuiGali.akuiPresent;
      scores.objectionHandling.akuiPresentQuote = akuiGali.akuiPresentQuote;
      scores.objectionHandling.galiPresent = akuiGali.galiPresent;
      scores.objectionHandling.galiPresentQuote = akuiGali.galiPresentQuote;
    }
  }

  return { scores, usage };
}

export function resolveApiKey() {
  const key = getAnthropicKey();
  if (!key) throw new Error("Tidak ada API key Anthropic aktif di AI Playground (data/ai-models.json) — Quality Scorer butuh key yang sama.");
  return key.apiKey;
}

export { buildSystemPrompt };
