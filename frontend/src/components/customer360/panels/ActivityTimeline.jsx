import React from "react";
import { ShoppingCart, StickyNote, MessageSquare, AlertTriangle, RefreshCw, History, ArrowRight } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { Button } from "@/components/ui/button.jsx";
import { buildTimeline, groupByDay } from "../lib/timelineAdapter.js";
import { formatWaktu } from "../../../utils/format.js";

const TYPE = {
  order:     { icon: ShoppingCart,  label: "Order",    tint: "bg-accentbg text-accent",        dot: "var(--accent)", soft: "var(--accent-bg)" },
  complaint: { icon: AlertTriangle, label: "Komplain", tint: "bg-redbg text-red", dot: "var(--red)", soft: "var(--red-bg)" },
  message:   { icon: MessageSquare, label: "WhatsApp", tint: "bg-greenbg text-green", dot: "var(--green)", soft: "var(--green-bg)" },
  note:      { icon: StickyNote,    label: "Catatan",  tint: "bg-inset text-ink2",       dot: "var(--text-secondary)", soft: "var(--bg-inset)" },
};

// Timeline gabungan (order/catatan/komplain/pesan-capped). loading/empty/error+retry.
export default function ActivityTimeline({ orders = [], notes = [], conversations = [], loading, error, onRetry, onSeeAll }) {
  if (loading) {
    return <div className="flex flex-col gap-2">{[...Array(4)].map((_, i) => <div key={i} className="skeleton" style={{ height: 44, borderRadius: 10 }} />)}</div>;
  }
  if (error) {
    return (
      <EmptyState icon={AlertTriangle} title="Gagal memuat aktivitas" description="Sebagian aktivitas (pesan) tidak bisa dimuat."
        action={<Button size="sm" variant="outline" onClick={onRetry}><RefreshCw size={13} /> Coba lagi</Button>} />
    );
  }
  const events = buildTimeline({ orders, notes, conversations });
  if (events.length === 0) {
    return <EmptyState icon={History} title="Belum ada aktivitas" description="Order, catatan, dan pesan akan muncul di sini." />;
  }
  const groups = groupByDay(events);

  return (
    <div className="flex flex-col gap-4">
      {groups.map((g) => (
        <div key={g.label}>
          <div className="mb-3 text-[10.5px] font-semibold uppercase tracking-wider text-ink3">{g.label}</div>
          {/* Alur vertikal (bukan kartu kotak) — node warna + garis penghubung. */}
          <div className="flex flex-col">
            {g.items.map((e, idx) => {
              const t = TYPE[e.type] || TYPE.note;
              const Icon = t.icon;
              const title = e.type === "message" ? (e.direction === "OUTBOUND" ? "Kita → customer" : "Customer → kita") : e.title;
              const last = idx === g.items.length - 1;
              return (
                <div key={e.id} className="flex gap-3">
                  {/* node + garis */}
                  <div className="flex flex-col items-center">
                    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${t.tint}`}><Icon size={12} /></span>
                    {!last && <span className="my-1 w-px flex-1 bg-line" />}
                  </div>
                  {/* konten mengalir, tanpa box */}
                  <div className="min-w-0 flex-1 pb-4">
                    <div className="flex items-baseline gap-2">
                      <span className="truncate text-[12.5px] font-semibold text-ink">{title}</span>
                      <span className="shrink-0 text-[9.5px] font-bold uppercase tracking-wide" style={{ color: t.dot }}>{t.label}</span>
                      <span className="ml-auto shrink-0 text-[10.5px] text-ink3">{formatWaktu(e.date)}</span>
                    </div>
                    <div className="mt-0.5 truncate text-[12px] text-ink2">{e.detail}{e.author ? ` · ${e.author}` : ""}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {onSeeAll && (
        <button
          onClick={onSeeAll}
          className="mt-1 flex w-full items-center justify-center gap-1 rounded-lg py-2 text-[12px] font-semibold text-accent transition-colors hover:bg-accentbg"
        >
          Lihat semua aktivitas <ArrowRight size={13} />
        </button>
      )}
    </div>
  );
}
