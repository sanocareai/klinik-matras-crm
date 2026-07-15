import { formatRupiahShort } from "../../../utils/format.js";

// Sinyal pelanggan diturunkan dari data yang SUDAH ADA (customer detail +
// conversations). Pure function — dasar untuk Health Score, Sano Insight, dan
// Next Action. Rule-based (BUKAN AI). Phase-4 LLM bisa mengganti mesinnya nanti.
export function deriveCustomerSignals(customer, conversations = []) {
  const orders = customer?.orders || [];
  const orderCount = orders.length;
  const orderValue = orders.reduce((s, o) => s + (o.value || 0), 0);
  const complaintsCount = customer?.riwayatKomplain?.length || orders.filter((o) => o.hasComplaint).length;

  // Pesan terakhir di seluruh percakapan (untuk recency + arah).
  let latest = null;
  for (const c of conversations) {
    for (const m of c.messages || []) {
      if (!latest || new Date(m.createdAt) > new Date(latest.createdAt)) latest = m;
    }
  }
  const lastMessageAt = latest?.createdAt || customer?.lastMessageAt || null;
  const lastInbound = latest?.direction === "INBOUND";
  const waitingMinutes = lastInbound && lastMessageAt
    ? Math.floor((Date.now() - new Date(lastMessageAt).getTime()) / 60000)
    : 0;
  const daysSince = lastMessageAt ? Math.floor((Date.now() - new Date(lastMessageAt).getTime()) / 86_400_000) : null;

  return { orders, orderCount, orderValue, complaintsCount, stage: customer?.pipelineStage, lastMessageAt, lastInbound, waitingMinutes, daysSince };
}

// Rekomendasi langkah berikutnya (rule-based) — aksi + alasan/konteks.
export function deriveNextAction(ctx) {
  if (ctx.complaintsCount > 0)
    return { label: "Tangani komplain — telepon langsung", reason: "Ada komplain terbuka. Trust rapuh, tangani cepat.", tone: "danger" };
  if (ctx.lastInbound && ctx.waitingMinutes > 180)
    return { label: "Balas follow-up yang menunggu", reason: `Pesan terakhir dari customer belum dibalas ${Math.floor(ctx.waitingMinutes / 60)} jam.`, tone: "warning" };
  if (ctx.stage === "QUOTED")
    return { label: "Tindak lanjuti penawaran", reason: "Penawaran sudah dikirim — dorong ke keputusan.", tone: "brand" };
  if (ctx.daysSince != null && ctx.daysSince > 30)
    return { label: "Reaktivasi — kirim info/penawaran baru", reason: `Sudah ${ctx.daysSince} hari tanpa interaksi.`, tone: "brand" };
  if (ctx.orderCount === 0 && ctx.stage === "QUALIFIED")
    return { label: "Tawarkan rekomendasi kasur", reason: "Prospek terkualifikasi, belum ada order.", tone: "brand" };
  return { label: "Jaga hubungan — pantau berkala", reason: "Hubungan sehat, tidak ada yang mendesak.", tone: "neutral" };
}

// Ringkasan "Sano Insight" — sintesis kalimat rule-based dari sinyal.
export function buildOverviewText(ctx, categoryLabel) {
  const parts = [];
  parts.push(ctx.orderCount > 0 ? `${ctx.orderCount} order (${formatRupiahShort(ctx.orderValue)})` : "belum ada order");
  if (ctx.daysSince != null) parts.push(ctx.daysSince <= 0 ? "aktif hari ini" : `aktif ${ctx.daysSince} hari lalu`);
  if (ctx.stage === "QUOTED") parts.push("sedang di tahap penawaran");
  if (ctx.complaintsCount > 0) parts.push(`${ctx.complaintsCount} komplain terbuka`);
  if (ctx.lastInbound && ctx.waitingMinutes > 180) parts.push("ada follow-up belum dibalas");
  const body = parts.join(", ");
  return `Kondisi ${categoryLabel.toLowerCase()} — ${body.charAt(0).toUpperCase() + body.slice(1)}.`;
}
