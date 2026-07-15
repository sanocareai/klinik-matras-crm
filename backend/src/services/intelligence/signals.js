import { THRESHOLDS as T } from "./weights.js";
import { detectIntents } from "./replyReadiness.js";

// Signal detector — PURE. Menurunkan sinyal dari data yang SUDAH ADA (customer +
// orders + conversations/messages). Deterministik & explainable. Termasuk
// `detectedIntents[]` (rule-based, INERT — hanya data untuk reply-readiness 4B/4C).
export function detectSignals(ctx) {
  const customer = ctx.customer || {};
  const conversations = ctx.conversations || [];
  const orders = customer.orders || [];

  const orderCount = orders.length;
  const orderValue = orders.reduce((s, o) => s + (o.value || 0), 0);
  const lastOrder = orders.reduce((a, o) => (!a || new Date(o.createdAt) > new Date(a.createdAt) ? o : a), null);
  const lastOrderDaysAgo = lastOrder ? Math.floor((Date.now() - new Date(lastOrder.createdAt).getTime()) / 86_400_000) : null;
  const complaintsOpen = customer.riwayatKomplain?.length || orders.filter((o) => o.hasComplaint).length;
  const stage = customer.pipelineStage || "LEAD";

  // Pesan terbaru + aktivitas (dari semua percakapan yang dimuat).
  let latest = null;
  const allMsgs = [];
  for (const c of conversations) {
    for (const m of c.messages || []) {
      allMsgs.push(m);
      if (!latest || new Date(m.createdAt) > new Date(latest.createdAt)) latest = m;
    }
  }
  const lastMessageAt = latest?.createdAt || null;
  const lastInbound = latest?.direction === "INBOUND";
  const daysSince = lastMessageAt ? Math.floor((Date.now() - new Date(lastMessageAt).getTime()) / 86_400_000) : null;
  const waitingMinutes = lastInbound && lastMessageAt ? Math.floor((Date.now() - new Date(lastMessageAt).getTime()) / 60_000) : 0;
  const recentCut = Date.now() - T.recentActivityDays * 86_400_000;
  const activityCount = allMsgs.filter((m) => new Date(m.createdAt).getTime() > recentCut).length;

  // Intent (rule-based) dari beberapa pesan INBOUND terakhir.
  const recentInboundText = allMsgs
    .filter((m) => m.direction === "INBOUND")
    .slice(0, 5)
    .map((m) => m.content || "")
    .join(" ");
  const detectedIntents = detectIntents(recentInboundText);

  const quotationAbandoned = stage === "QUOTED" && daysSince != null && daysSince > T.abandonedQuoteDays;
  const isReturning = orderCount >= 1;

  return {
    stage, orderCount, orderValue, lastOrderDaysAgo, complaintsOpen,
    lastMessageAt, lastInbound, daysSince, waitingMinutes, activityCount,
    detectedIntents, quotationAbandoned, isReturning,
  };
}
