import { HEALTH_WEIGHTS as W } from "./weights.js";
import { rpShort } from "./format.js";

// Customer Health Score — KUALITAS RELASI. Port PERSIS dari customer360 3A
// (agar migrasi Customer360 nanti behavior-preserving). Pure & explainable.
const CAT = {
  Healthy: { label: "Sehat", variant: "success" },
  "Needs Attention": { label: "Perlu Perhatian", variant: "warning" },
  "At Risk": { label: "Berisiko", variant: "danger" },
};

export function computeHealth(s) {
  const signals = [];
  let score = W.base;

  if (s.orderCount > 0) {
    score += W.orderBase + Math.min(W.orderValueMax, Math.round((s.orderValue / W.orderValuePer) * W.orderValueMax));
    signals.push({ type: "positive", label: `${s.orderCount} order · ${rpShort(s.orderValue)}` });
  }
  if (s.stage === "WON") { score += W.stage.WON; signals.push({ type: "positive", label: "Deal berhasil" }); }
  else if (s.stage === "QUOTED") { score += W.stage.QUOTED; signals.push({ type: "positive", label: "Aktivitas penawaran" }); }
  else if (s.stage === "QUALIFIED") { score += W.stage.QUALIFIED; signals.push({ type: "positive", label: "Prospek terkualifikasi" }); }

  if (s.daysSince != null && s.daysSince <= 2) { score += W.recency.d2; signals.push({ type: "positive", label: s.daysSince <= 0 ? "Aktif hari ini" : `Aktif ${s.daysSince} hari lalu` }); }
  else if (s.daysSince != null && s.daysSince <= 7) { score += W.recency.d7; signals.push({ type: "positive", label: `Aktif ${s.daysSince} hari lalu` }); }
  else if (s.daysSince != null && s.daysSince <= 14) { score += W.recency.d14; }

  if (s.complaintsOpen > 0) { score -= W.complaintPenalty; signals.push({ type: "negative", label: `${s.complaintsOpen} komplain terbuka` }); }
  if (s.daysSince != null && s.daysSince > 60) { score -= W.inactivity.d60; signals.push({ type: "negative", label: `Tidak aktif ${s.daysSince} hari` }); }
  else if (s.daysSince != null && s.daysSince > 30) { score -= W.inactivity.d30; signals.push({ type: "negative", label: `Tidak aktif ${s.daysSince} hari` }); }
  if (s.lastInbound && s.waitingMinutes > 180) { score -= W.unansweredPenalty; signals.push({ type: "negative", label: `Follow-up belum dibalas ${Math.floor(s.waitingMinutes / 60)}j` }); }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const key = score >= 80 ? "Healthy" : score >= 50 ? "Needs Attention" : "At Risk";

  let trend = null, trendLabel = null;
  if (s.daysSince != null) {
    if (s.complaintsOpen > 0) { trend = "down"; trendLabel = "Menurun — ada komplain"; }
    else if (s.daysSince > 30) { trend = "down"; trendLabel = "Menurun — makin pasif"; }
    else if (s.daysSince <= 3 && (s.orderCount > 0 || s.stage === "QUOTED" || s.stage === "WON")) { trend = "up"; trendLabel = "Menguat — aktif & bertransaksi"; }
    else { trend = "flat"; trendLabel = "Stabil"; }
  }

  return { score, categoryKey: key, category: CAT[key].label, variant: CAT[key].variant, trend, trendLabel, signals };
}
