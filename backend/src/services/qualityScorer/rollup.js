// ═══ ROLLUP MINGGUAN — AI Conversation Quality Scorer ════════════════════
// Agregasi baris ConversationQualityScore per sales: rata-rata per dimensi,
// tren vs minggu sebelumnya, dan 2-3 contoh terbaik/terlemah (dari overall
// score = rata-rata 4 dimensi yang TERISI, dimensi null tidak ikut dihitung
// supaya percakapan singkat yang wajar tidak sempat bahas 1-2 dimensi tidak
// dihukum seolah skornya 0 di situ).
import { prisma } from "../../db.js";
import { CORE_DIMENSIONS, PATTERN_DIMENSIONS } from "../../config/qualityScorerRubric.js";

const DIM_TO_COLUMN = {
  productKnowledge: "productKnowledgeScore",
  consultationProcess: "consultationProcessScore",
  healthImpact: "healthImpactScore",
  objectionHandling: "objectionHandlingScore",
};

function overallScore(row) {
  const vals = Object.values(DIM_TO_COLUMN).map((col) => row[col]).filter((v) => v != null);
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function avgByDim(rows) {
  const out = {};
  for (const { key } of CORE_DIMENSIONS) {
    const col = DIM_TO_COLUMN[key];
    const vals = rows.map((r) => r[col]).filter((v) => v != null);
    out[key] = vals.length > 0 ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null;
  }
  return out;
}

// ── Pattern aggregation (dimensi E & F) — 26 Agustus 2026 ─────────────────
// TERPISAH dari avgByDim/overallScore di atas (yang tetap murni 4 dimensi
// lama) supaya section dashboard existing tidak ikut berubah nilai/tampilan
// hanya karena dimensi baru ditambahkan. Semua dihitung dari kolom DB biasa
// (skor + flag boolean) — TIDAK ada panggilan LLM di fungsi ini.
function patternMetricsForRows(rows, prevRows) {
  const out = {};
  for (const dim of PATTERN_DIMENSIONS) {
    const scoreCol = `${dim.key}Score`;
    const flagCol = dim.flag.key;

    const scored = rows.map((r) => r[scoreCol]).filter((v) => v != null);
    const avgScore = scored.length > 0 ? Math.round((scored.reduce((a, b) => a + b, 0) / scored.length) * 10) / 10 : null;

    const prevScored = prevRows.map((r) => r[scoreCol]).filter((v) => v != null);
    const prevAvgScore = prevScored.length > 0 ? Math.round((prevScored.reduce((a, b) => a + b, 0) / prevScored.length) * 10) / 10 : null;

    const trend = avgScore != null && prevAvgScore != null ? Math.round((avgScore - prevAvgScore) * 10) / 10 : null;

    // Flag null (topik tidak muncul) DIKELUARKAN dari basis persentase —
    // "frekuensi flag negatif" hanya bermakna dari percakapan yang memang
    // relevan dinilai utk flag ini (sama prinsip null-safety dgn skor).
    const flagVals = rows.map((r) => r[flagCol]).filter((v) => v != null);
    const negativeFlagRatePct = flagVals.length > 0
      ? Math.round((flagVals.filter((v) => v === false).length / flagVals.length) * 1000) / 10
      : null;

    out[dim.key] = {
      label: dim.label,
      flagKey: flagCol,
      avgScore, prevAvgScore, trend,
      sampleCountForScore: scored.length,
      sampleCountForFlag: flagVals.length,
      negativeFlagRatePct,
    };
  }
  return out;
}

/**
 * Rollup mingguan. `weekStart`/`weekEnd` = batas instant UTC eksklusif
 * (pemanggil/route yang menerjemahkan tanggal WIB ke batas ini, konsisten
 * dgn pola seluruh sistem "UTC di dalam, WIB di tepi").
 */
export async function getWeeklyRollup({ weekStart, weekEnd, prevWeekStart, prevWeekEnd }) {
  const [rows, prevRows] = await Promise.all([
    prisma.conversationQualityScore.findMany({ where: { sampledFor: { gte: weekStart, lt: weekEnd } } }),
    prevWeekStart && prevWeekEnd
      ? prisma.conversationQualityScore.findMany({ where: { sampledFor: { gte: prevWeekStart, lt: prevWeekEnd } } })
      : Promise.resolve([]),
  ]);

  const bySales = new Map();
  for (const r of rows) {
    if (!bySales.has(r.salesUserId)) bySales.set(r.salesUserId, { salesUserId: r.salesUserId, salesName: r.salesName, rows: [] });
    bySales.get(r.salesUserId).rows.push(r);
  }
  const prevAvgBySales = new Map();
  for (const r of prevRows) {
    if (!prevAvgBySales.has(r.salesUserId)) prevAvgBySales.set(r.salesUserId, []);
    prevAvgBySales.get(r.salesUserId).push(r);
  }

  const perSales = [...bySales.values()].map(({ salesUserId, salesName, rows: salesRows }) => {
    const dims = avgByDim(salesRows);
    const scored = salesRows.map((r) => ({ ...r, _overall: overallScore(r) })).filter((r) => r._overall != null);
    const overallAvg = scored.length > 0
      ? Math.round((scored.reduce((a, r) => a + r._overall, 0) / scored.length) * 10) / 10
      : null;

    const prevRowsForSales = prevAvgBySales.get(salesUserId) || [];
    const prevScored = prevRowsForSales.map((r) => overallScore(r)).filter((v) => v != null);
    const prevOverallAvg = prevScored.length > 0
      ? Math.round((prevScored.reduce((a, b) => a + b, 0) / prevScored.length) * 10) / 10
      : null;
    const trend = overallAvg != null && prevOverallAvg != null
      ? Math.round((overallAvg - prevOverallAvg) * 10) / 10
      : null;

    const sortedByOverall = [...scored].sort((a, b) => b._overall - a._overall);
    const best = sortedByOverall.slice(0, 3).map(formatExample);
    const worst = sortedByOverall.slice(-3).reverse().map(formatExample);

    return {
      salesUserId, salesName,
      sampleCount: salesRows.length,
      dimensions: dims,
      overallAvg, prevOverallAvg, trend,
      bestExamples: best,
      worstExamples: worst,
      // Pattern aggregation (Closing Assertiveness & Customer Comprehension)
      // — TIDAK ikut overallAvg/trend/bestExamples/worstExamples di atas,
      // section dashboard existing tetap identik nilainya.
      patternDimensions: patternMetricsForRows(salesRows, prevRowsForSales),
    };
  });

  perSales.sort((a, b) => (b.overallAvg ?? -1) - (a.overallAvg ?? -1));

  return { weekStart, weekEnd, totalScored: rows.length, perSales };
}

function formatExample(r) {
  return {
    conversationId: r.conversationId,
    overallScore: Math.round(r._overall * 10) / 10,
    pipelineStageAtSample: r.pipelineStageAtSample,
    sampledFor: r.sampledFor,
    dimensions: Object.fromEntries(
      CORE_DIMENSIONS.map(({ key }) => {
        const col = DIM_TO_COLUMN[key];
        const quoteCol = `${col.replace("Score", "Quote")}`;
        const noteCol = `${col.replace("Score", "Note")}`;
        return [key, { score: r[col], quote: r[quoteCol], note: r[noteCol] }];
      })
    ),
    overallNote: r.overallNote,
  };
}
