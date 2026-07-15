import { formatRupiahShort } from "../../../utils/format.js";

// Customer Health Score — TRANSPARAN & rule-based (bukan AI, tanpa false
// precision). Kategori (ambang tetap): 80–100 Healthy, 50–79 Needs Attention,
// 0–49 At Risk. Setiap sinyal yang berkontribusi dikembalikan sebagai chip
// (explainable). Bobot sengaja sederhana & mudah diatur.
export const CATEGORY = {
  Healthy: { label: "Sehat", variant: "success" },
  "Needs Attention": { label: "Perlu Perhatian", variant: "warning" },
  "At Risk": { label: "Berisiko", variant: "danger" },
};

export function computeHealthScore(ctx) {
  const signals = [];
  let score = 50; // netral

  // ── POSITIF ──
  if (ctx.orderCount > 0) {
    score += 20 + Math.min(15, Math.round((ctx.orderValue / 5_000_000) * 15));
    signals.push({ type: "positive", label: `${ctx.orderCount} order · ${formatRupiahShort(ctx.orderValue)}` });
  }
  if (ctx.stage === "WON") { score += 15; signals.push({ type: "positive", label: "Deal berhasil" }); }
  else if (ctx.stage === "QUOTED") { score += 10; signals.push({ type: "positive", label: "Aktivitas penawaran" }); }
  else if (ctx.stage === "QUALIFIED") { score += 5; signals.push({ type: "positive", label: "Prospek terkualifikasi" }); }

  if (ctx.daysSince != null && ctx.daysSince <= 2) { score += 15; signals.push({ type: "positive", label: ctx.daysSince <= 0 ? "Aktif hari ini" : `Aktif ${ctx.daysSince} hari lalu` }); }
  else if (ctx.daysSince != null && ctx.daysSince <= 7) { score += 10; signals.push({ type: "positive", label: `Aktif ${ctx.daysSince} hari lalu` }); }
  else if (ctx.daysSince != null && ctx.daysSince <= 14) { score += 5; }

  // ── NEGATIF ──
  if (ctx.complaintsCount > 0) { score -= 25; signals.push({ type: "negative", label: `${ctx.complaintsCount} komplain terbuka` }); }
  if (ctx.daysSince != null && ctx.daysSince > 60) { score -= 25; signals.push({ type: "negative", label: `Tidak aktif ${ctx.daysSince} hari` }); }
  else if (ctx.daysSince != null && ctx.daysSince > 30) { score -= 15; signals.push({ type: "negative", label: `Tidak aktif ${ctx.daysSince} hari` }); }
  if (ctx.lastInbound && ctx.waitingMinutes > 180) { score -= 10; signals.push({ type: "negative", label: `Follow-up belum dibalas ${Math.floor(ctx.waitingMinutes / 60)}j` }); }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const key = score >= 80 ? "Healthy" : score >= 50 ? "Needs Attention" : "At Risk";
  return { score, categoryKey: key, category: CATEGORY[key].label, variant: CATEGORY[key].variant, signals };
}
