import { rpShort } from "./format.js";

// Sano Insight — ringkasan RULE-BASED templated (BUKAN AI, no hallucination).
// Selalu traceable ke sinyal. Pure.
export function generateInsight(s, scores) {
  const parts = [];
  parts.push(s.orderCount > 0 ? `Riwayat pembelian ${s.orderCount} order (${rpShort(s.orderValue)})` : "Belum ada riwayat pembelian");
  if (s.stage === "QUOTED") parts.push("sedang di tahap penawaran");
  if (s.daysSince != null) parts.push(s.daysSince <= 0 ? "aktif hari ini" : `aktif ${s.daysSince} hari lalu`);

  let text = parts.join(", ") + ".";
  const caveats = [];
  if (s.complaintsOpen > 0) caveats.push("ada komplain yang belum selesai");
  if (s.lastInbound && s.waitingMinutes > 180) caveats.push("ada follow-up yang belum dibalas");
  if (caveats.length) text += " Namun " + caveats.join(" dan ") + ".";
  text += ` Kondisi relasi: ${scores.health.category}.`;
  return text;
}
