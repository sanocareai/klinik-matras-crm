import React from "react";
import { AlertTriangle, CalendarDays, ChevronsUp, Flame, ImageOff, PackageX, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge.jsx";
import { ProgressBar } from "@/components/ui/progress.jsx";
import { bucketStyle, initials, targetDateBadge } from "@/features/production/experience.js";
import { dataGaps, materialBadge, mejaLabel, priorityMeta, stageText } from "@/features/production/unitCardModel.js";
import { formatRupiah } from "@/utils/format.js";

// P9 UX Realignment — SATU kartu unit untuk Status Produksi, Rencana Produksi (backlog + slot meja), dan Quality
// Control. Klik kartu = buka Unit 360 (aksi utama); aksi sekunder (Jadwalkan/Pindahkan, Putusan QC, Unit Tiba) ada di
// `footer` dan tidak ikut memicu klik kartu. `variant="photo"` = foto besar di atas (Status/QC); `variant="compact"` =
// foto samping (slot meja & backlog Rencana) — isi informasi sama, hanya tata letak yang berbeda.

function PriorityTag({ priority, className = "" }) {
  const p = priorityMeta(priority);
  if (!p.icon) return null;
  const Icon = p.icon === "urgent" ? Flame : ChevronsUp;
  return (
    <span data-testid="priority-tag" data-priority={p.key} className={`inline-flex items-center gap-1 rounded-chip bg-red px-2 py-0.5 text-[11px] font-bold text-white ${className}`}>
      <Icon size={12} aria-hidden /> {p.label}
    </span>
  );
}

export function UnitPhoto({ photoUrl, variant, className = "" }) {
  const size = variant === "compact" ? "h-16 w-16" : "h-28 w-full";
  return (
    <div className={`relative shrink-0 overflow-hidden bg-inset ${variant === "compact" ? "rounded-btn" : "rounded-t-card"} ${size} ${className}`}>
      {photoUrl
        ? <img src={photoUrl} alt="Foto unit" className="h-full w-full object-cover" loading="lazy" />
        : (
          <div data-testid="photo-empty" className="flex h-full w-full flex-col items-center justify-center gap-1 border border-dashed border-line text-ink3">
            <ImageOff size={variant === "compact" ? 18 : 26} aria-hidden />
            {variant !== "compact" && <span className="text-[11.5px] font-medium">Belum ada foto</span>}
          </div>
        )}
    </div>
  );
}

export function PicChips({ view }) {
  const t = view?.plan?.operator?.name, c = view?.plan?.cornerOperator?.name;
  if (!t && !c) return <span className="text-[11.5px] text-ink3">PIC belum ditetapkan</span>;
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-[11.5px] text-ink2">
      {t && <span className="inline-flex items-center gap-1" title={`PIC Table: ${t}`}><span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[9px] font-bold text-white">{initials(t)}</span>{t}</span>}
      {c && c !== t && <span className="inline-flex items-center gap-1" title={`PIC Corner: ${c}`}><span className="flex h-5 w-5 items-center justify-center rounded-full bg-bluesolid text-[9px] font-bold text-white">{initials(c)}</span>{c}</span>}
    </span>
  );
}

export function UnitCard({
  view, onOpen, footer = null, variant = "photo", today, tomorrow, draggable = false, onDragStart, showGaps = true, className = "", qcBadge = null, seq = null,
}) {
  if (!view) return null;
  const c = view.customer || {};
  const p = priorityMeta(view.plan?.priority ?? 0);
  const st = bucketStyle(view.bucket);
  const dateBadge = today && tomorrow ? targetDateBadge(view, today, tomorrow) : null;
  const gaps = showGaps ? dataGaps(view) : [];
  const mat = materialBadge(view);
  const sales = c.salesServices?.length ? c.salesServices.join(" + ") : null;
  const progress = view.progress?.total ? (view.progress.done / view.progress.total) * 100 : 0;
  const open = () => onOpen?.(view);
  const station = view.plan?.stationCode ? mejaLabel(view.plan.stationCode) : "Belum dijadwalkan";

  const head = (
    <div className="min-w-0">
      <p className="m-0 truncate text-[13.5px] font-bold text-ink" title={`${view.unit.unitCode}${c.orderNumber ? ` · ${c.orderNumber}` : ""}`}>{view.unit.unitCode}{c.orderNumber ? <span className="font-medium text-ink3"> · {c.orderNumber}</span> : null}</p>
      <p className="m-0 truncate text-[12.5px] font-semibold text-ink2" title={c.name || ""}>{c.name || "Pelanggan belum dicatat"}{c.city ? <span className="font-normal text-ink3"> · {c.city}</span> : null}</p>
    </div>
  );
  const body = (
    <div className={`min-w-0 space-y-1.5 ${variant === "compact" ? "px-3 pb-3" : "px-3 pb-3"}`}>
      <p className="m-0 line-clamp-2 text-[12px] text-ink2" title={sales || ""}>
        <span className="font-semibold text-ink3">Layanan Sales: </span>{sales || <span className="text-ink3">belum tercatat</span>}
      </p>
      {c.request && (
        <p data-testid="sales-note" className="m-0 line-clamp-2 break-words text-[11.5px] italic text-ink3 [overflow-wrap:anywhere]" title={c.request}>“{c.request}”</p>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant={st.badge}>{st.label}</Badge>
        {view.next?.stepNo && <span className="text-[11.5px] font-medium text-ink2">{stageText(view)}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {dateBadge && <Badge variant={dateBadge.tone}>{dateBadge.label}</Badge>}
        {view.plan?.productionDate && <span className="inline-flex items-center gap-1 text-[11.5px] text-ink3"><CalendarDays size={12} aria-hidden /> Target {view.plan.productionDate}</span>}
        {view.plan && mat && <Badge variant={mat.tone}>{mat.label}</Badge>}
        {view.orderValue != null && <span className="text-[11.5px] font-semibold text-ink2">{formatRupiah(view.orderValue)}</span>}
      </div>
      <div className="flex items-center justify-between gap-2"><PicChips view={view} /></div>
      {view.progress && (
        <div className="flex items-center gap-2">
          <div className="flex-1"><ProgressBar value={progress} variant={view.shortage ? "warning" : "accent"} /></div>
          <span className="shrink-0 text-[11px] text-ink3 tabular-nums">{view.progress.done}/{view.progress.total} tahap</span>
        </div>
      )}
      {qcBadge}
      {view.shortage && <p className="m-0 flex items-center gap-1 text-[11.5px] font-medium text-red"><PackageX size={12} aria-hidden /> Menunggu bahan: {view.shortage.items?.map((i) => i.name).join(", ")}</p>}
      {gaps.length > 0 && (
        <ul data-testid="data-gaps" className="m-0 flex list-none flex-wrap gap-1 p-0">
          {gaps.map((g) => <li key={g} className="inline-flex items-center gap-1 rounded-chip bg-orangebg px-1.5 py-0.5 text-[10.5px] font-medium text-orange"><AlertTriangle size={10} aria-hidden /> {g}</li>)}
        </ul>
      )}
    </div>
  );

  return (
    <article data-testid="unit-card" data-unit-code={view.unit.unitCode} data-priority={p.key} draggable={draggable} onDragStart={onDragStart}
      className={`relative w-full min-w-0 overflow-hidden rounded-card bg-surface shadow-sm ${p.edge} ${view.bucket === "MENUNGGU_BAHAN" ? "ring-1 ring-orange/40" : ""} ${draggable ? "cursor-grab active:cursor-grabbing" : ""} ${className}`}>
      <button type="button" onClick={open} className="block w-full text-left hover:bg-hovertint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent" aria-label={`Buka Unit 360 ${view.unit.unitCode}`}>
        {variant === "compact" ? (
          <>
            <div className="flex gap-3 p-3">
              <UnitPhoto photoUrl={view.unit.photoUrl} variant="compact" />
              <div className="min-w-0 flex-1 space-y-1.5">
                {head}
                <div className="flex flex-wrap items-center gap-1.5">{seq != null && <span data-testid="seq" className="rounded-chip bg-accentbg px-2 py-0.5 text-[11px] font-bold text-accent">Urutan {seq}</span>}<PriorityTag priority={view.plan?.priority ?? 0} />{seq == null && <Badge variant="neutral">{station}</Badge>}</div>
              </div>
            </div>
            {body}
          </>
        ) : (
          <>
            <div className="relative">
              <UnitPhoto photoUrl={view.unit.photoUrl} variant="photo" />
              <div className="absolute left-2 top-2"><PriorityTag priority={view.plan?.priority ?? 0} /></div>
              <div className="absolute right-2 top-2"><span className="inline-flex items-center gap-1 rounded-chip bg-surface/95 px-2 py-0.5 text-[11px] font-semibold text-ink shadow-sm"><Wrench size={11} aria-hidden /> {station}</span></div>
            </div>
            <div className="px-3 pt-3">{head}</div>
            <div className="pt-1.5">{body}</div>
          </>
        )}
      </button>
      {footer && <div className="border-t border-line px-3 py-2">{footer}</div>}
    </article>
  );
}

// Kartu ringan untuk unit "Akan Masuk" (pickup terjadwal, belum ada Run) — tetap satu bahasa visual dengan UnitCard.
export function UpcomingCard({ item, onOpen, footer = null, badgeLabel = "Akan Masuk" }) {
  const c = item.customer || {};
  return (
    <article data-testid="unit-card" data-unit-code={item.unit.unitCode} className="relative w-full min-w-0 overflow-hidden rounded-card border-l-[4px] border-l-transparent bg-surface shadow-sm">
      <button type="button" onClick={() => onOpen?.(item.unit.id)} className="block w-full text-left hover:bg-hovertint" aria-label={`Buka Unit 360 ${item.unit.unitCode}`}>
        <UnitPhoto photoUrl={item.unit.photoUrl} variant="photo" />
        <div className="space-y-1.5 p-3">
          <p className="m-0 truncate text-[13.5px] font-bold text-ink">{item.unit.unitCode}{item.unit.orderNumber ? <span className="font-medium text-ink3"> · {item.unit.orderNumber}</span> : null}</p>
          <p className="m-0 truncate text-[12.5px] font-semibold text-ink2">{c.name || "Pelanggan belum dicatat"}{c.city ? <span className="font-normal text-ink3"> · {c.city}</span> : null}</p>
          <p className="m-0 line-clamp-2 text-[12px] text-ink2"><span className="font-semibold text-ink3">Layanan Sales: </span>{c.salesServices?.length ? c.salesServices.join(" + ") : <span className="text-ink3">belum tercatat</span>}</p>
          {c.request && <p data-testid="sales-note" className="m-0 line-clamp-2 break-words text-[11.5px] italic text-ink3 [overflow-wrap:anywhere]">“{c.request}”</p>}
          <div className="flex flex-wrap items-center gap-1.5"><Badge variant="neutral">{badgeLabel}</Badge>{item.scheduledDate && <span className="text-[11.5px] text-ink3">Pickup {item.scheduledDate}</span>}{item.driverName && <span className="text-[11.5px] text-ink3">· {item.driverName}</span>}</div>
          {!item.unit.photoUrl && <ul data-testid="data-gaps" className="m-0 flex list-none flex-wrap gap-1 p-0"><li className="inline-flex items-center gap-1 rounded-chip bg-orangebg px-1.5 py-0.5 text-[10.5px] font-medium text-orange"><AlertTriangle size={10} aria-hidden /> Foto unit belum ada</li></ul>}
        </div>
      </button>
      {footer && <div className="border-t border-line px-3 py-2">{footer}</div>}
    </article>
  );
}
