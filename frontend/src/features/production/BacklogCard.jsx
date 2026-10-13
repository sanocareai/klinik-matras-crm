import React from "react";
import { CalendarDays, Info, ShieldAlert, Truck } from "lucide-react";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import { UnitPhoto } from "@/features/production/UnitCard.jsx";
import { priorityMeta } from "@/features/production/unitCardModel.js";
import PkrRujukan from "@/features/production/PkrRujukan.jsx";
import { priorityOf, receivedBasisText, salesServicesText, scheduleStatusText, statusOf, statusTone } from "@/features/production/productionLabels.js";
import { formatUkuranLabel, teksUkuranDariNotes } from "@/utils/ukuranKasur.js";

// Kartu ringkas backlog untuk unit yang BELUM punya kartu rencana penuh (order nyata tanpa Run). Satu bahasa visual dengan PlanCard. Aksi berikutnya SELALU jelas dan datang dari server
// (`item.rencana`): ONBOARD_SCHEDULE = tombol Jadwalkan + handle seret (sama persis dengan kartu lain; Run dibuka di transaksi yang sama dengan penjadwalan), selain itu penjelasan
// + langkah berikutnya TANPA instruksi seret. Tiga hal terpisah — status, posisi fisik, prioritas — dan hanya Layanan Sales. Klik kartu = buka Unit 360.
const NOTE_TONE = { AWAIT_ACTIVATION: "text-orange", WAIT_PICKUP: "text-ink2", EXCEPTION: "text-red" };
const NOTE_ICON = { WAIT_PICKUP: Truck, EXCEPTION: ShieldAlert };

export default function BacklogCard({ item, onOpen, onSchedule = null, handle = null, dragging = false, busy = false }) {
  const c = item.card; if (!c) return null;
  const r = item.rencana || null;
  const onboardable = !!r?.onboardable;
  // Belum diaktifkan tetapi pemanggil (ADMIN/OWNER) boleh mengaktifkannya SAAT dijadwalkan: server menandai `activatable`; kartu bisa diseret ke Meja, aktivasi dikonfirmasi di formulir Jadwalkan.
  const activatable = !onboardable && !!r?.activatable;
  const draggable = onboardable || activatable;
  const pr = priorityOf({ priority: c.priority });
  const meta = priorityMeta(pr.key === "COMPLAINT" ? 3 : pr.key === "HIGH" ? 1 : 0);
  const Icon = NOTE_ICON[r?.action] || Info;
  // Milestone global dari server (berbasis bukti); sumbu jadwal & posisi fisik terpisah dari status global.
  const st = statusOf({ globalStatus: c.globalStatus, unitStatusDisplay: c.unitStatus });
  const jadwal = scheduleStatusText(c); const dasar = receivedBasisText(c);
  const statusColor = st.key === "PENGAMBILAN" ? "accent" : st.key === "DITERIMA_WORKSHOP" ? "green" : statusTone(st.key);
  const ukuran = formatUkuranLabel(c.unit.ukuran) || teksUkuranDariNotes(c.customer.request) || "Ukuran belum dicatat";
  const nextLine = st.detail || dasar || (activatable ? "Aktivasi dikonfirmasi saat menjadwalkan" : null);
  return (
    <article data-testid="backlog-card" data-unit-code={c.unit.unitCode} data-priority={pr.key} data-rencana-action={r?.action || undefined} data-drag-card={draggable ? "" : undefined}
      className={`relative w-full min-w-0 shrink-0 overflow-hidden rounded-card bg-surface shadow-sm ${dragging ? "opacity-40" : ""}`}>
      <span aria-hidden className={`absolute inset-y-0 left-0 ${meta.stripeClass}`} />
      {draggable && handle && <div className="absolute right-2 top-2 z-10">{handle}</div>}
      <button type="button" onClick={() => onOpen?.(c.unit.id)} aria-label={`Buka Unit 360 ${c.unit.unitCode}`} className={`block w-full min-w-0 py-2.5 pl-4 text-left hover:bg-hovertint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${draggable && handle ? "pr-14" : "pr-3"}`}>
        <span className="flex min-w-0 items-start gap-2.5">
          <UnitPhoto photoUrl={c.unit.photoUrl} variant="plan" />
          <span className="min-w-0 flex-1">
            <span className="block break-words text-[14px] font-bold leading-tight text-ink [overflow-wrap:anywhere]" title={c.customer.name || undefined}>{c.customer.name || "Pelanggan belum dicatat"}</span>
            <span className="mt-0.5 block break-words text-[11.5px] text-ink3 [overflow-wrap:anywhere]" title={[c.unit.unitCode, c.customer.orderNumber].filter(Boolean).join(" · ")}>{c.unit.unitCode}{c.customer.orderNumber ? ` · ${c.customer.orderNumber}` : ""}</span>
          </span>
        </span>
        <span className="mt-2 block min-w-0 space-y-0.5 text-[12px] leading-snug text-ink2">
          <span className="block break-words [overflow-wrap:anywhere]"><span className="font-semibold text-ink3">Layanan Sales · </span>{salesServicesText(c.customer.salesServices)}</span>
          <span className="block"><span className="font-semibold text-ink3">Ukuran · </span><span data-testid="backlog-size">{ukuran}</span></span>
        </span>
        <PkrRujukan pkr={c.penjualanKaryawan} />
        <span className="mt-2 flex flex-wrap items-center gap-1">
          <Badge variant={statusColor} data-testid="status-badge" data-global-status={st.key}>{st.label || "—"}</Badge>
          {meta.icon && <span data-testid="priority-tag" className={`inline-flex items-center rounded-chip px-2 py-0.5 text-[11px] font-bold ${meta.badgeClass}`}>{pr.label}</span>}
          {activatable && <Badge variant="orange" data-testid="rencana-activate-note">Perlu aktivasi</Badge>}
          {jadwal && <span data-testid="schedule-badge" className="text-[11px] text-ink3">{jadwal}</span>}
        </span>
        {nextLine && <span data-testid="status-detail" title={nextLine} className="mt-1.5 block line-clamp-2 text-[11.5px] leading-snug text-ink3">{nextLine}</span>}
        {c.photoNote && <span data-testid="photo-note" data-photo-status={c.photoNote.status} title={c.photoNote.text} className="mt-1 flex items-start gap-1 text-[11px] text-ink3"><Info size={12} className="mt-0.5 shrink-0" aria-hidden /><span className="line-clamp-2">{c.photoNote.text}</span></span>}
      </button>
      {r && <div className="border-t border-line px-3 py-2 pl-4" data-testid="rencana-next">
        {draggable ? <Button size="sm" data-mutates data-testid="backlog-schedule" className="min-h-[40px] w-full" disabled={busy} onClick={() => onSchedule?.(item)}><CalendarDays size={13} aria-hidden /> {activatable ? "Aktifkan & Jadwalkan" : "Jadwalkan"}</Button>
          : <p data-testid="rencana-message" className={`m-0 flex items-start gap-1.5 text-[12px] font-medium ${NOTE_TONE[r.action] || "text-ink2"}`}><Icon size={14} className="mt-0.5 shrink-0" aria-hidden /><span className="line-clamp-2" title={[r.message, r.next].filter(Boolean).join(" · ")}><span className="font-semibold">Langkah berikutnya: </span>{r.next || r.message}</span></p>}
      </div>}
    </article>
  );
}
