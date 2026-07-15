import { PRIORITY_WEIGHTS as W, THRESHOLDS as T } from "./weights.js";
import { rpShort } from "./format.js";

// Priority Score — URGENSI SALES ("act now"). Sinyal mendesak (komplain,
// belum dibalas, penawaran nyangkut) bobot tinggi; nilai/intent menariknya naik.
// Pure & explainable — `reasons[]` menjelaskan skor.
export function computePriority(s) {
  const reasons = [];
  let score = 0;

  if (s.complaintsOpen > 0) { score += W.complaintOpen; reasons.push("Komplain belum selesai"); }
  if (s.lastInbound && s.waitingMinutes > T.unansweredMinutes) {
    const daysWaiting = Math.floor(s.waitingMinutes / 1440);
    score += W.unansweredBase + Math.min(W.unansweredMaxExtra, daysWaiting * W.unansweredPerDay);
    reasons.push(`Belum dibalas ${Math.floor(s.waitingMinutes / 60)} jam`);
  }
  if (s.quotationAbandoned) { score += W.quotationAbandoned; reasons.push("Penawaran belum direspons"); }
  if (s.detectedIntents.length > 0) { score += W.intentAny; reasons.push("Ada sinyal minat"); }
  if (s.orderValue >= W.highValueMin) { score += W.highValue; reasons.push(`Nilai transaksi tinggi (${rpShort(s.orderValue)})`); }
  if (s.stage === "QUOTED") { score += W.stageQuoted; }
  if (s.daysSince != null && s.daysSince <= 2) { score += W.recentActive; }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const urgency = score >= 70 ? "high" : score >= 40 ? "medium" : "low";
  return { score, reasons, urgency };
}
