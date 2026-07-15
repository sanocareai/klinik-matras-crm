import { formatRupiahShort, ORDER_STATUS_LABELS } from "../../../utils/format.js";

// Adapter timeline CLIENT-SIDE — gabung event dari data yang SUDAH ADA
// (order, catatan, komplain, pesan) jadi satu daftar terurut. Pesan DI-CAP
// (recent), TIDAK memuat seluruh riwayat chat — riwayat penuh ada di tab
// "Riwayat Chat" & tombol "Buka Chat". Pure function, mudah dites.
// Kalau nanti butuh, sebuah read-only endpoint bisa menggantikan ini.
const MSG_CAP = 15;

export function buildTimeline({ orders = [], notes = [], conversations = [] }) {
  const events = [];

  for (const o of orders) {
    events.push({
      id: `order-${o.id}`, type: "order", date: o.createdAt,
      title: `Order ${o.orderNumber || ""}`.trim(),
      detail: `${ORDER_STATUS_LABELS[o.status] || o.status} · ${formatRupiahShort(o.value || 0)}`,
    });
    if (o.hasComplaint) {
      events.push({
        id: `complaint-${o.id}`, type: "complaint",
        date: o.complaintDate || o.updatedAt || o.createdAt,
        title: "Komplain", detail: o.complaintDetail || `Order ${o.orderNumber || ""}`.trim(),
      });
    }
  }

  for (const n of notes) {
    events.push({ id: `note-${n.id}`, type: "note", date: n.createdAt, title: "Catatan", detail: n.content, author: n.author?.name });
  }

  // Pesan: kumpulkan lalu ambil hanya yang terbaru (cap) — bukan semua.
  const msgs = [];
  for (const c of conversations) {
    for (const m of c.messages || []) {
      msgs.push({
        id: `msg-${m.id}`, type: "message", date: m.createdAt, direction: m.direction,
        detail: m.content || (m.mediaType ? `[${m.mediaType}]` : "(pesan)"),
      });
    }
  }
  msgs.sort((a, b) => new Date(b.date) - new Date(a.date));
  events.push(...msgs.slice(0, MSG_CAP));

  events.sort((a, b) => new Date(b.date) - new Date(a.date));
  return events;
}

// Kelompokkan per hari untuk header timeline ("Hari ini" / "Kemarin" / tanggal).
export function groupByDay(events) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const groups = [];
  const byKey = {};
  for (const e of events) {
    const d = new Date(e.date); d.setHours(0, 0, 0, 0);
    const diff = Math.round((today - d) / 86_400_000);
    const label = diff <= 0 ? "Hari ini" : diff === 1 ? "Kemarin"
      : new Date(e.date).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
    if (!byKey[label]) { byKey[label] = { label, items: [] }; groups.push(byKey[label]); }
    byKey[label].items.push(e);
  }
  return groups;
}
