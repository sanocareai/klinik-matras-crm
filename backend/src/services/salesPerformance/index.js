// ═══ SALES PERFORMANCE INTELLIGENCE — orchestrator ═════════════════════════
// "Siapa butuh coaching, kenapa, dan harus belajar apa?" — TIDAK membuat
// sistem skoring AI baru. Murni menggabungkan 3 output yang SUDAH ADA:
//   - Quality Scorer (rollup.js)      → quality score, skill trend, strength/weakness
//   - Sales Risk Engine (salesRisk/)  → risk contribution
//   - SLA/response-time (analytics.js)→ SLA discipline
// Health Score = kombinasi tertimbang deterministik dari ketiganya
// (healthScore.js), BUKAN panggilan LLM baru.
import { prisma } from "../../db.js";
import { getActiveSalesUsers } from "../qualityScorer/sampling.js";
import { getWeeklyRollup, getMultiWeekTrend } from "../qualityScorer/rollup.js";
import { CORE_DIMENSIONS } from "../../config/qualityScorerRubric.js";
import { computeAllSalesRisks, aggregateBySalesOwner } from "../salesRisk/index.js";
import { computeSalesRow, buildSalesReportContext } from "../../routes/analytics.js";
import { computeHealthScore } from "./healthScore.js";

function toDateStringWIB(date) {
  return new Date(date.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
}

// Strength = dimensi dgn rata-rata TERTINGGI minggu ini, Weakness = TERENDAH
// — dari rollup yang SUDAH dihitung (dims: {key: avgScore}), bukan hitung
// ulang. null-safe kalau belum ada sample sama sekali minggu ini.
function strengthWeaknessFromDims(dims) {
  let best = null, worst = null;
  for (const dim of CORE_DIMENSIONS) {
    const avg = dims[dim.key];
    if (avg == null) continue;
    if (!best || avg > best.avg) best = { key: dim.key, label: dim.label, avg };
    if (!worst || avg < worst.avg) worst = { key: dim.key, label: dim.label, avg };
  }
  return { strength: best, weakness: worst };
}

/**
 * Profil individual utk SEMUA sales aktif, periode rolling `days` hari.
 */
export async function getIndividualProfiles({ days = 30 } = {}) {
  const now = new Date();
  const weekEnd = now;
  const weekStart = new Date(now.getTime() - days * 86_400_000);
  const prevWeekEnd = weekStart;
  const prevWeekStart = new Date(weekStart.getTime() - days * 86_400_000);

  const [salesUsers, rollup, allRisks, slaCtx] = await Promise.all([
    getActiveSalesUsers(),
    getWeeklyRollup({ weekStart, weekEnd, prevWeekStart, prevWeekEnd }),
    computeAllSalesRisks(),
    buildSalesReportContext({ from: toDateStringWIB(weekStart), to: toDateStringWIB(weekEnd) }),
  ]);

  const rollupByUser = new Map(rollup.perSales.map((r) => [r.salesUserId, r]));
  const riskGroups = aggregateBySalesOwner(allRisks);
  const riskByUser = new Map(riskGroups.map((g) => [g.salesOwnerId, g]));

  const profiles = await Promise.all(salesUsers.map(async (u) => {
    const rollupRow = rollupByUser.get(u.id) || null;
    const riskGroup = riskByUser.get(u.id) || null;
    const salesRow = await computeSalesRow(u, slaCtx);
    const slaBreachRate = salesRow.handled > 0 ? salesRow.slaBreach / salesRow.handled : null;

    const { score: healthScore, components: healthComponents } = computeHealthScore({
      qualityAvg: rollupRow?.overallAvg ?? null,
      riskCounts: riskGroup?.counts ?? null,
      slaBreachRate,
    });

    const { strength, weakness } = strengthWeaknessFromDims(rollupRow?.dimensions || {});

    // Rekomendasi training: prioritaskan pola dari Sales Risk Engine kalau
    // ADA kasus aktif (lebih mendesak — kasus nyata yang perlu ditangani),
    // fallback ke dimensi Quality Scorer terlemah (pengembangan proaktif,
    // rule-based sederhana: hint TERBANYAK di antara risiko customer sales
    // ini, bukan hitung ulang via LLM).
    let recommendedTraining = null;
    if (riskGroup?.risks?.length) {
      const hintCounts = {};
      for (const r of riskGroup.risks) {
        if (!r.trainingModuleHint) continue;
        hintCounts[r.trainingModuleHint] = (hintCounts[r.trainingModuleHint] || 0) + 1;
      }
      const top = Object.entries(hintCounts).sort((a, b) => b[1] - a[1])[0];
      if (top) recommendedTraining = top[0];
    }
    if (!recommendedTraining) recommendedTraining = weakness?.label || null;

    const skillTrend = await getMultiWeekTrend(u.id, { weeks: 6, referenceNow: now });

    return {
      userId: u.id,
      name: u.name,
      healthScore,
      healthComponents,
      qualityScore: rollupRow?.overallAvg ?? null,
      qualityTrend: rollupRow?.trend ?? null,
      riskContribution: riskGroup?.counts || { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 },
      slaDiscipline: {
        handled: salesRow.handled,
        avgResponseMinutes: salesRow.avgResponseMinutes,
        slaBreach: salesRow.slaBreach,
        slaBreachRate: slaBreachRate != null ? Math.round(slaBreachRate * 1000) / 10 : null,
      },
      skillTrend,
      strength,
      weakness,
      recommendedTraining,
      sampleCount: rollupRow?.sampleCount || 0,
    };
  }));

  return profiles;
}

/**
 * Ringkasan TIM dari profil individual yang SUDAH dihitung di atas — murni
 * agregasi array, tidak ada query tambahan.
 */
export function buildTeamDashboard(profiles) {
  const withScore = profiles.filter((p) => p.healthScore != null);
  const averageHealthScore = withScore.length
    ? Math.round(withScore.reduce((s, p) => s + p.healthScore, 0) / withScore.length)
    : null;

  const sorted = [...withScore].sort((a, b) => b.healthScore - a.healthScore);
  const topPerformer = sorted[0] || null;
  const needsAttention = sorted.filter((p) => p.healthScore < 60).reverse().slice(0, 5);

  const skillGapCounts = {};
  for (const p of profiles) {
    if (!p.recommendedTraining) continue;
    skillGapCounts[p.recommendedTraining] = (skillGapCounts[p.recommendedTraining] || 0) + 1;
  }
  const skillGapDistribution = Object.entries(skillGapCounts)
    .map(([module, count]) => ({ module, count }))
    .sort((a, b) => b.count - a.count);

  // Rekomendasi coaching TIM — rule-based (bukan LLM): modul yang paling
  // sering jadi rekomendasi individual, disertai jumlah sales yang terdampak.
  const coachingRecommendation = skillGapDistribution.length
    ? `${skillGapDistribution[0].count} dari ${profiles.length} sales perlu perkuatan ${skillGapDistribution[0].module}.`
    : "Tidak ada gap keterampilan yang menonjol saat ini.";

  return { averageHealthScore, topPerformer, needsAttention, skillGapDistribution, coachingRecommendation };
}
