import React from "react";
import { CalendarDays, Hourglass, Info, ShieldAlert, Truck } from "lucide-react";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import { UnitPhoto } from "@/features/production/UnitCard.jsx";
import { priorityMeta } from "@/features/production/unitCardModel.js";
import PkrRujukan from "@/features/production/PkrRujukan.jsx";
import { presenceTone, priorityOf, salesServicesText, statusTone } from "@/features/production/productionLabels.js";

// Kartu ringkas backlog untuk unit yang BELUM punya kartu rencana penuh (order nyata tanpa Run). Satu bahasa visual dengan PlanCard. Aksi berikutnya SELALU jelas dan datang dari server
// (`item.rencana`): ONBOARD_SCHEDULE = tombol Jadwalkan + handle seret (sama persis dengan kartu lain; Run dibuka di transaksi yang sama dengan penjadwalan), selain itu penjelasan
// + langkah berikutnya TANPA instruksi seret. Tiga hal terpisah — status, posisi fisik, prioritas — dan hanya Layanan Sales. Klik kartu = buka Unit 360.
const NOTE_TONE = { AWAIT_ACTIVATION: "text-orange", WAIT_PICKUP: "text-ink2", EXCEPTION: "text-red" };
const NOTE_ICON = { AWAIT_ACTIVATION: Hourglass, WAIT_PICKUP: Truck, EXCEPTION: ShieldAlert };

export default function BacklogCard({ item, onOpen, onSchedule = null, handle = null, dragging = false, busy = false }) {
  const c = item.card; if (!c) return null;
  const r = item.rencana || null;
  const onboardable = !!r?.onboardable;
  const pr = priorityOf({ priority: c.priority });
  const meta = priorityMeta(pr.key === "COMPLAINT" ? 3 : pr.key === "HIGH" ? 1 : 0);
  const Icon = NOTE_ICON[r?.action] || Info;
  return (
    <article data-testid="backlog-card" data-unit-code={c.unit.unitCode} data-priority={pr.key} data-rencana-action={r?.action || undefined} data-drag-card={onboardable ? "" : undefined}
      className={`relative w-full min-w-0 shrink-0 overflow-hidden rounded-card bg-surface shadow-sm ${dragging ? "opacity-40" : ""}`}>
      <span aria-hidden className={`absolute inset-y-0 left-0 ${meta.stripeClass}`} />
      {onboardable && handle && <div className="absolute right-2 top-2 z-10">{handle}</div>}
      <button type="button" onClick={() => onOpen?.(c.unit.id)} aria-label={`Buka Unit 360 ${c.unit.unitCode}`} className={`flex w-full min-w-0 items-start gap-3 py-3 pl-5 text-left hover:bg-hovertint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${onboardable && handle ? "pr-14" : "pr-3"}`}>
        <span className="flex shrink-0 flex-col items-center gap-1">
          <UnitPhoto photoUrl={c.unit.photoUrl} variant="plan" />
        </span>
        <span className="min-w-0 flex-1 space-y-1.5">
          <span className="block break-words text-[15px] font-bold leading-tight text-ink [overflow-wrap:anywhere]">{c.customer.name || "Pelanggan belum dicatat"}</span>
          <span className="block truncate text-[12.5px] text-ink3">{c.unit.unitCode}{c.customer.orderNumber ? ` · ${c.customer.orderNumber}` : ""}</span>
          <span className="block break-words text-[13px] text-ink2 [overflow-wrap:anywhere]"><span className="font-semibold text-ink3">Layanan Sales: </span>{salesServicesText(c.customer.salesServices)}</span>
          <PkrRujukan pkr={c.penjualanKaryawan} />
          <span className="flex flex-wrap items-center gap-1.5">
            {meta.icon && <span data-testid="priority-tag" className={`inline-flex items-center rounded-chip px-2 py-0.5 text-[11.5px] font-bold uppercase tracking-wide ${meta.badgeClass}`}>{pr.label}</span>}
            <Badge variant={statusTone(c.unitStatus?.key)} data-testid="status-badge">{c.unitStatus?.label || "—"}</Badge>
            {c.presence?.label && <Badge variant={presenceTone(c.presence)} data-testid="presence-badge">{c.presence.label}</Badge>}
          </span>
          {c.photoNote && <span data-testid="photo-note" data-photo-status={c.photoNote.status} className="flex items-start gap-1 text-[12px] text-ink3"><Info size={12} className="mt-0.5 shrink-0" aria-hidden />{c.photoNote.text}</span>}
        </span>
      </button>
      <div className="border-t border-line px-3 py-2 pl-5" data-testid="rencana-next">
        {onboardable ? (
          <div className="space-y-1.5">
            <p data-testid="rencana-message" className="m-0 text-[12px] text-ink3">{r.message}</p>
            <Button size="sm" data-mutates data-testid="backlog-schedule" className="min-h-[44px] w-full" disabled={busy} onClick={() => onSchedule?.(item)}><CalendarDays size={13} aria-hidden /> Jadwalkan</Button>
          </div>
        ) : r ? (
          <div className="space-y-0.5">
            <p data-testid="rencana-message" className={`m-0 flex items-start gap-1.5 text-[12.5px] font-semibold ${NOTE_TONE[r.action] || "text-ink2"}`}><Icon size={14} className="mt-0.5 shrink-0" aria-hidden />{r.message}</p>
            {r.next && <p data-testid="rencana-next-action" className="m-0 pl-5 text-[12px] text-ink2"><span className="font-semibold text-ink3">Langkah berikutnya: </span>{r.next}</p>}
          </div>
        ) : null}
      </div>
    </article>
  );
}
