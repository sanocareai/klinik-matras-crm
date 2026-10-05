import React from "react";
import { Badge } from "@/components/ui/badge.jsx";
import { UnitPhoto } from "@/features/production/UnitCard.jsx";
import { priorityMeta } from "@/features/production/unitCardModel.js";
import { presenceTone, priorityOf, salesServicesText, statusTone } from "@/features/production/productionLabels.js";

// Kartu ringkas backlog untuk unit yang BELUM bisa dijadwalkan dari halaman ini (tidak punya rencana di Rencana Produksi): satu bahasa visual dengan PlanCard,
// tanpa tombol jadwal. Tiga hal terpisah — status, posisi fisik, prioritas — dan hanya Layanan Sales. Klik = buka Unit 360.
export default function BacklogCard({ item, onOpen }) {
  const c = item.card; if (!c) return null;
  const pr = priorityOf({ priority: c.priority });
  const meta = priorityMeta(pr.key === "COMPLAINT" ? 3 : pr.key === "HIGH" ? 1 : 0);
  return (
    <article data-testid="backlog-card" data-unit-code={c.unit.unitCode} data-priority={pr.key} className="relative w-full min-w-0 shrink-0 overflow-hidden rounded-card bg-surface shadow-sm">
      <span aria-hidden className={`absolute inset-y-0 left-0 ${meta.stripeClass}`} />
      <button type="button" onClick={() => onOpen?.(c.unit.id)} aria-label={`Buka Unit 360 ${c.unit.unitCode}`} className="flex w-full min-w-0 items-start gap-3 py-3 pl-5 pr-3 text-left hover:bg-hovertint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">
        <UnitPhoto photoUrl={c.unit.photoUrl} variant="plan" />
        <span className="min-w-0 flex-1 space-y-1.5">
          <span className="block break-words text-[15px] font-bold leading-tight text-ink [overflow-wrap:anywhere]">{c.customer.name || "Pelanggan belum dicatat"}</span>
          <span className="block truncate text-[12.5px] text-ink3">{c.unit.unitCode}{c.customer.orderNumber ? ` · ${c.customer.orderNumber}` : ""}</span>
          <span className="block break-words text-[13px] text-ink2 [overflow-wrap:anywhere]"><span className="font-semibold text-ink3">Layanan Sales: </span>{salesServicesText(c.customer.salesServices)}</span>
          <span className="flex flex-wrap items-center gap-1.5">
            {meta.icon && <span data-testid="priority-tag" className={`inline-flex items-center rounded-chip px-2 py-0.5 text-[11.5px] font-bold uppercase tracking-wide ${meta.badgeClass}`}>{pr.label}</span>}
            <Badge variant={statusTone(c.unitStatus?.key)} data-testid="status-badge">{c.unitStatus?.label || "—"}</Badge>
            {c.presence?.label && <Badge variant={presenceTone(c.presence)} data-testid="presence-badge">{c.presence.label}</Badge>}
          </span>
          <span data-testid="not-schedulable" className="block text-[12px] text-ink3">Belum bisa dijadwalkan dari halaman ini.</span>
        </span>
      </button>
    </article>
  );
}
