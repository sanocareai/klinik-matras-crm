import { THRESHOLDS as T } from "./weights.js";

// Next Best Action — aturan berurutan IF/THEN (yang cocok pertama menang).
// Pure & explainable → { action, reason, urgency }.
export function nextBestAction(s) {
  if (s.complaintsOpen > 0 && (s.daysSince == null || s.daysSince >= 1))
    return { action: "Selesaikan komplain — telepon langsung", reason: "Ada komplain terbuka. Trust rapuh, tangani cepat.", urgency: "urgent" };
  if (s.lastInbound && s.waitingMinutes > T.unansweredMinutes)
    return { action: "Balas follow-up yang menunggu", reason: `Pesan customer belum dibalas ${Math.floor(s.waitingMinutes / 60)} jam.`, urgency: "high" };
  if (s.quotationAbandoned)
    return { action: "Follow up penawaran", reason: "Penawaran terkirim, belum direspons.", urgency: "high" };
  if (s.isReturning && s.lastOrderDaysAgo != null && s.lastOrderDaysAgo > T.repeatOrderDays)
    return { action: "Tawarkan repeat order", reason: `Order terakhir ${Math.floor(s.lastOrderDaysAgo / 30)} bulan lalu.`, urgency: "medium" };
  if (s.stage === "QUALIFIED" && s.orderCount === 0)
    return { action: "Tawarkan rekomendasi kasur", reason: "Prospek terkualifikasi, belum ada order.", urgency: "medium" };
  if (s.daysSince != null && s.daysSince > T.inactivity30)
    return { action: "Reaktivasi — kirim info/penawaran", reason: `Sudah ${s.daysSince} hari tanpa interaksi.`, urgency: "low" };
  return { action: "Jaga hubungan — pantau berkala", reason: "Hubungan sehat, tidak ada yang mendesak.", urgency: "low" };
}
