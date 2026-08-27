// ═══ SALES HEALTH SCORE — komposit dari 3 sistem yang SUDAH ADA ═══════════
// BUKAN skor AI baru — murni kombinasi tertimbang dari angka yang SUDAH
// dihitung sistem lain (Quality Scorer, Sales Risk Engine, SLA/response-
// time di analytics.js). Bobot dikonfirmasi owner: 50% quality, 30% risk
// (inverse), 20% disiplin SLA (inverse).
export const HEALTH_WEIGHTS = { quality: 0.5, risk: 0.3, sla: 0.2 };

// Bobot risiko per tier — CRITICAL paling berat. Cap dipakai supaya 1 sales
// dengan banyak sekali kasus risiko tidak sampai "melebihi 100% buruk" —
// nilai cap HEURISTIK/tunable (didokumentasikan, belum diverifikasi luas
// ke data produksi, sama status dgn BOOKING_READINESS_PATTERN di
// salesRisk/weights.js).
const RISK_TIER_WEIGHT = { CRITICAL: 3, HIGH: 2, MEDIUM: 1, LOW: 0 };
const RISK_BADNESS_CAP = 20;

// counts = { CRITICAL, HIGH, MEDIUM, LOW } dari aggregateBySalesOwner()
// (Sales Risk Engine) — null-safe kalau sales itu tidak muncul sama sekali
// di hasil risk (berarti tidak ada kasus, risiko-nya SEMPURNA = 100).
export function riskToHealthComponent(counts) {
  if (!counts) return 100;
  const raw = Object.entries(RISK_TIER_WEIGHT).reduce((sum, [tier, w]) => sum + (counts[tier] || 0) * w, 0);
  const capped = Math.min(raw, RISK_BADNESS_CAP);
  return Math.round((1 - capped / RISK_BADNESS_CAP) * 100);
}

// qualityAvg = overallAvg dari getWeeklyRollup() (Quality Scorer), skala 0-5.
export function qualityToHealthComponent(qualityAvg) {
  if (qualityAvg == null) return null;
  return Math.round((qualityAvg / 5) * 100);
}

// slaBreachRate = slaBreach/handled dari computeSalesRow() (analytics.js),
// 0-1. null kalau handled=0 (tidak ada percakapan di periode ini).
export function slaToHealthComponent(slaBreachRate) {
  if (slaBreachRate == null) return null;
  return Math.round((1 - Math.min(1, slaBreachRate)) * 100);
}

// Null-safe: komponen yang datanya tidak ada (mis. sales baru, belum
// pernah di-grading Quality Scorer) DIKELUARKAN dari perhitungan & bobot
// SISANYA dinormalisasi ulang — bukan dianggap 0 (yang akan menghukum
// sales itu seolah performanya buruk, padahal cuma belum ada datanya).
export function computeHealthScore({ qualityAvg, riskCounts, slaBreachRate }) {
  const components = {
    quality: qualityToHealthComponent(qualityAvg),
    risk: riskToHealthComponent(riskCounts),
    sla: slaToHealthComponent(slaBreachRate),
  };

  let weightedSum = 0;
  let weightTotal = 0;
  for (const [key, value] of Object.entries(components)) {
    if (value == null) continue;
    weightedSum += value * HEALTH_WEIGHTS[key];
    weightTotal += HEALTH_WEIGHTS[key];
  }

  const score = weightTotal > 0 ? Math.round(weightedSum / weightTotal) : null;
  return { score, components };
}
