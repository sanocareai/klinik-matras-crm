import React from "react";
import { ShoppingCart, StickyNote, MessageSquare, AlertTriangle, RefreshCw, History } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { Button } from "@/components/ui/button.jsx";
import { buildTimeline, groupByDay } from "../lib/timelineAdapter.js";
import { formatWaktu } from "../../../utils/format.js";

const TYPE = {
  order:     { icon: ShoppingCart, tint: "bg-brand-50 text-brand-600" },
  note:      { icon: StickyNote,   tint: "bg-slate-100 text-slate-500" },
  complaint: { icon: AlertTriangle, tint: "bg-chart-rose-soft text-chart-rose" },
  message:   { icon: MessageSquare, tint: "bg-chart-green-soft text-chart-green" },
};

// Timeline gabungan (order/catatan/komplain/pesan-capped). loading/empty/error+retry.
export default function ActivityTimeline({ orders = [], notes = [], conversations = [], loading, error, onRetry }) {
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
          <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-wider text-slate-400">{g.label}</div>
          <div className="flex flex-col gap-2.5">
            {g.items.map((e) => {
              const t = TYPE[e.type] || TYPE.note;
              const Icon = t.icon;
              return (
                <div key={e.id} className="flex gap-3">
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${t.tint}`}><Icon size={13} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[12.5px] font-semibold text-slate-800">
                        {e.type === "message" ? (e.direction === "OUTBOUND" ? "Kita → customer" : "Customer → kita") : e.title}
                      </span>
                      <span className="shrink-0 text-[10.5px] text-slate-400">{formatWaktu(e.date)}</span>
                    </div>
                    <div className="truncate text-[12px] text-slate-500">{e.detail}{e.author ? ` · ${e.author}` : ""}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
