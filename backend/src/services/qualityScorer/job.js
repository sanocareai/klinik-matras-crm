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

// v tidak string/tidak ada di `allowed` (case-insensitive) → null. Sama
// prinsip null-safety dgn normalizeFlag: LLM yang menyebut nilai enum tak
// dikenal cukup di-null-kan, bukan disimpan mentah/bikin insert gagal.
function normalizeEnum(v, allowed) {
  if (typeof v !== "string") return null;
  const upper = v.trim().toUpperCase();
  return allowed.includes(upper) ? upper : null;
}

// 28 Agustus 2026 (Evidence-Based Selling, evidenceUsed) — versi array dari
// normalizeEnum. BEDA PENTING dari normalizeEnum/normalizeFlag: kembalikan
// `null` HANYA kalau `v` bukan array sama sekali (sinyal "coba lokasi
// fallback lain", sama pola dgn field lain) — kalau `v` MEMANG array (even
// kosong []), itu dianggap hasil SAH (bukan "tidak ditemukan"), difilter ke
// elemen valid saja (case-insensitive, dedup). Prisma String[] tidak bisa
// null, jadi caller (dimResult) tidak boleh menyimpan null utk field ini —
// [] dipakai sbg representasi "dimensi tidak berlaku" (lihat schema.prisma).
function normalizeEnumArray(v, allowed) {
  if (!Array.isArray(v)) return null;
  const seen = new Set();
  for (const item of v) {
    if (typeof item !== "string") continue;
    const upper = item.trim().toUpperCase();
    if (allowed.includes(upper)) seen.add(upper);
  }
  return [...seen];
}

// Generik utk SEMUA dimensi (4 lama tanpa flag, 2 baru dengan flag) — dim
// tanpa `flag` menghasilkan `flag: undefined` (tidak ditulis ke DB sama
// sekali oleh caller), PERSIS perilaku sebelum dimensi E/F ditambahkan.
//
// FALLBACK top-level (26 Agustus 2026, investigasi live): walau prompt
// (qualityScorerRubric.js) sudah instruksikan flag ditaruh BERSARANG di
// dalam objek dimensinya (`scores[dim.key][dim.flag.key]`), LLM kadang
// (diverifikasi: 17-58% dari baris yang skornya terisi) malah menaruhnya
// sebagai key TERPISAH di root JSON (`scores[dim.flag.key]`) — masih JSON
// valid, cuma salah lokasi. Dicoba nested DULU, baru fallback ke root,
// supaya flag tidak hilang jadi null cuma gara-gara salah taruh, BUKAN
// karena topiknya memang tidak muncul di percakapan.
// "note" tunggal (rubrik lama) DIGANTI "strength"+"weakness" terpisah (27
// Agustus 2026, rubrik SANO Sales Framework) — permintaan eksplisit owner.
//
// `extraFields` (28 Agustus 2026, Objection Handling: objectionType/
// frameworkFollowed) memakai FALLBACK YANG SAMA PERSIS dgn flag di atas —
// pelajaran yang sama berlaku, bukan cuma utk boolean tapi juga enum.
// Diekspor (28 Agustus 2026, sama alasan dgn buildDimFields di bawah) —
// dipakai scripts/backfillAuthorityStructure.js utk re-ekstrak SATU dimensi
// (evidenceBasedSelling) saja tanpa ikut menyentuh dimensi lain (buildDimFields
// menghitung SEMUA dimensi sekaligus, tidak cocok utk backfill partial).
export function dimResult(scores, dim) {
  const d = scores?.[dim.key];
  if (!d || d.score == null) {
    const empty = {
      score: null, quote: null, strength: null, weakness: null,
      quote2: dim.secondQuote ? null : undefined,
      flag: dim.flag ? null : undefined,
    };
    for (const ef of dim.extraFields || []) {
      // enum_array TIDAK BOLEH null (Prisma String[] non-nullable) — []
      // dipakai sbg representasi "dimensi tidak berlaku", lihat schema.prisma.
      empty[ef.key] = ef.kind === "enum_array" ? [] : null;
      if (ef.hasQuote) empty[`${ef.key}Quote`] = null;
    }
    if (dim.key === "objectionHandling") {
      empty.frameworkFollowed = null; empty.frameworkFollowedQuote = null;
      empty.akuiPresent = null; empty.akuiPresentQuote = null;
      empty.galiPresent = null; empty.galiPresentQuote = null;
    }
    if (dim.key === "evidenceBasedSelling") {
      empty.authorityStructureFollowed = null; // legacy, derivasi 4 field authority* di bawah
    }
    return empty;
  }
  let flag;
  if (dim.flag) {
    const nested = normalizeFlag(d[dim.flag.key]);
    flag = nested !== null ? nested : normalizeFlag(scores?.[dim.flag.key]);
  }
  const result = {
    score: Number(d.score),
    quote: d.quote ?? null,
    strength: d.strength ?? null,
    weakness: d.weakness ?? null,
    flag,
  };
  if (dim.secondQuote) {
    result.quote2 = d.quote2 ?? scores?.quote2 ?? null;
  }
  for (const ef of dim.extraFields || []) {
    const normalize =
      ef.kind === "boolean" ? normalizeFlag :
      ef.kind === "enum_array" ? (v) => normalizeEnumArray(v, ef.values) :
      (v) => normalizeEnum(v, ef.values);
    let value = normalize(d[ef.key]);
    if (value === null) value = normalize(scores?.[ef.key]); // fallback top-level, sama pola dgn flag
    result[ef.key] = value;
    if (ef.hasQuote) {
      result[`${ef.key}Quote`] = d[`${ef.key}Quote`] ?? scores?.[`${ef.key}Quote`] ?? null;
    }
  }
  // Aturan KHUSUS dimensi Evidence-Based Selling (bukan mekanisme generik
  // extraFields di atas — tergantung NILAI field lain, bukan cuma score
  // induk): evidenceExplained tidak bermakna apa pun kalau memang tidak ada
  // bukti nyata dipakai (evidenceUsed kosong/["TIDAK_ADA"]) — null-kan,
  // jangan biarkan false (false akan terbaca "sales GAGAL jelaskan bukti",
  // padahal memang tidak ada bukti utk dijelaskan sama sekali).
  if (dim.key === "evidenceBasedSelling" && Array.isArray(result.evidenceUsed)) {
    const hasRealEvidence = result.evidenceUsed.some((v) => v !== "TIDAK_ADA");
    if (!hasRealEvidence) result.evidenceExplained = null;
  }
  // authorityStructureFollowed (28 Agustus 2026) — LEGACY, dihitung DI KODE
  // sbg AND() dari 4 field authority* granular di atas (pola sama dgn
  // frameworkFollowed=AND(akuiPresent,galiPresent) di objectionHandling).
  // null-safety: kalau SALAH SATU dari 4 field null (gagal diekstrak/topik
  // tidak berlaku), ikut null — bukan ditebak false.
  if (dim.key === "evidenceBasedSelling") {
    const steps = [
      result.authorityReferensiPresent,
      result.authorityHedgeLanguageUsed,
      result.authorityMekanismeExplained,
      result.authoritySolusiConnected,
    ];
    result.authorityStructureFollowed = steps.some((s) => s == null) ? null : steps.every(Boolean);
  }
  // akuiPresent/galiPresent (28 Agustus 2026) — BUKAN extraFields generik
  // lagi (dipisah jadi 2 panggilan sekuensial terpisah, lihat grading.js#
  // extractAkuiGali) — dibaca LANGSUNG dari `d` (sudah berupa boolean/null
  // bersih hasil normalizeFlag() di grading.js, bukan raw LLM JSON yang
  // butuh fallback top-level). frameworkFollowed DIHITUNG di sini sbg
  // AND(akuiPresent, galiPresent), null-safety: kalau SALAH SATU null
  // (gagal diekstrak/topik tidak berlaku), frameworkFollowed ikut null —
  // "tidak tahu" lebih jujur drpd menebak true/false dari separuh
  // informasi. frameworkFollowedQuote TIDAK diisi lagi (digantikan
  // akuiPresentQuote/galiPresentQuote yang lebih spesifik).
  if (dim.key === "objectionHandling") {
    result.akuiPresent = d.akuiPresent ?? null;
    result.akuiPresentQuote = d.akuiPresentQuote ?? null;
    result.galiPresent = d.galiPresent ?? null;
    result.galiPresentQuote = d.galiPresentQuote ?? null;
    result.frameworkFollowed =
      result.akuiPresent == null || result.galiPresent == null
        ? null
        : result.akuiPresent && result.galiPresent;
    result.frameworkFollowedQuote = null;
  }
  return result;
}

// Diekspor (bukan cuma dipakai lokal di runQualityScorerJob) supaya script
// backfill satu-off bisa memakai EKSTRAKSI YANG SAMA PERSIS, bukan menyalin
// ulang logikanya — kalau nanti prompt/skema berubah lagi, cukup 1 tempat.
export function buildDimFields(scores) {
  const dimFields = {};
  for (const dim of RUBRIC_DIMENSIONS) {
    const r = dimResult(scores, dim);
    dimFields[`${dim.key}Score`] = r.score;
    dimFields[`${dim.key}Quote`] = r.quote;
    if (dim.secondQuote) dimFields[`${dim.key}Quote2`] = r.quote2;
    dimFields[`${dim.key}Strength`] = r.strength;
    dimFields[`${dim.key}Weakness`] = r.weakness;
    if (dim.flag) dimFields[dim.flag.key] = r.flag;
    for (const ef of dim.extraFields || []) {
      dimFields[ef.key] = r[ef.key];
      if (ef.hasQuote) dimFields[`${ef.key}Quote`] = r[`${ef.key}Quote`];
    }
    // akuiPresent/galiPresent/frameworkFollowed BUKAN extraFields lagi
    // (dihitung/diekstrak terpisah — lihat dimResult()) jadi ditulis manual
    // di sini, khusus objectionHandling.
    if (dim.key === "objectionHandling") {
      dimFields.akuiPresent = r.akuiPresent;
      dimFields.akuiPresentQuote = r.akuiPresentQuote;
      dimFields.galiPresent = r.galiPresent;
      dimFields.galiPresentQuote = r.galiPresentQuote;
      dimFields.frameworkFollowed = r.frameworkFollowed;
      dimFields.frameworkFollowedQuote = r.frameworkFollowedQuote;
    }
    // authorityStructureFollowed BUKAN extraFields lagi (dihitung di
    // dimResult() dari 4 field authority* granular) — ditulis manual di
    // sini, khusus evidenceBasedSelling. Sama pola dgn frameworkFollowed.
    if (dim.key === "evidenceBasedSelling") {
      dimFields.authorityStructureFollowed = r.authorityStructureFollowed;
    }
  }
  return dimFields;
}

// Rekomendasi modul SANO Class — RULE-BASED (dimensi dgn skor TERENDAH di
// antara yang terisi), BUKAN LLM. Deterministik & tanpa biaya tambahan.
export function computeRecommendedModule(dimFields) {
  let worst = null;
  for (const dim of RUBRIC_DIMENSIONS) {
    const score = dimFields[`${dim.key}Score`];
    if (score == null) continue;
    if (!worst || score < worst.score) worst = { score, label: dim.label };
  }
  return worst ? worst.label : null;
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
      // +RUBRIC_DIMENSIONS.length (bukan +1) — 28 Agustus 2026: gradeTranscript()
      // sekarang membuat 1 panggilan Anthropic TERPISAH per dimensi (fix bug
      // JSON-escaping), jadi 1 "percakapan" = beberapa panggilan LLM sungguhan.
      // MAX_DAILY_LLM_CALLS dimaksudkan sbg batas KERAS panggilan API asli
      // (lihat komentar di qualityScorerRubric.js) — kalau tetap +1 di sini,
      // batas itu diam-diam menjadi 3x lebih longgar dari nilai yang di-set.
      callsUsed += RUBRIC_DIMENSIONS.length;
      try {
        const messages = await fetchTranscriptMessages(row.conversationId, selesai);
        if (messages.length === 0) continue; // percakapan kosong, tidak layak dinilai
        const transcriptText = formatTranscript(messages, row.customerName);

        const { scores, usage } = await gradeTranscript({ systemPrompt, transcriptText, apiKey });
        const costUsd = estimateCostUsd(usage);
        summary.totalCostUsd += costUsd;
        // +2 kalau akuiGali sungguhan jalan (ada keberatan terdeteksi) —
        // sama prinsip dgn callsUsed += RUBRIC_DIMENSIONS.length di atas,
        // MAX_DAILY_LLM_CALLS harus mencerminkan panggilan API ASLI.
        if (scores.objectionHandling?.score != null) callsUsed += 2;

        const dimFields = buildDimFields(scores);

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
            recommendedModule: computeRecommendedModule(dimFields),
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
