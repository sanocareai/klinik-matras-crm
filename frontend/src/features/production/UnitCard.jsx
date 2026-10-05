import React from "react";
import { AlertTriangle, CalendarDays, ChevronsUp, Flame, ImageOff, PackageX, Scissors, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge.jsx";
import { ProgressBar } from "@/components/ui/progress.jsx";
import { bucketStyle, initials, targetDateBadge } from "@/features/production/experience.js";
import { dataGaps, isGantiKain, materialBadge, mattressInfo, mejaLabel, priorityMeta, salesNoteOf, stageText } from "@/features/production/unitCardModel.js";

// P9 UX Realignment — SATU kartu unit untuk Status Produksi, Rencana Produksi (backlog + slot meja), dan Quality
// Control. Klik kartu = buka Unit 360 (aksi utama); aksi sekunder (Jadwalkan/Pindahkan, Putusan QC, Unit Tiba) ada di
// `footer` dan tidak ikut memicu klik kartu. `variant="photo"` = foto besar di atas (Status/QC); `variant="compact"` =
// foto samping (slot meja & backlog Rencana) — isi informasi sama, hanya tata letak yang berbeda.

function PriorityTag({ priority, className = "" }) {
  const p = priorityMeta(priority);
  if (!p.icon) return null;
  const Icon = p.icon === "urgent" ? Flame : ChevronsUp;
  return (
    <span data-testid="priority-tag" data-priority={p.key} className={`inline-flex items-center gap-1 rounded-chip px-2 py-0.5 text-[11.5px] font-bold uppercase tracking-wide ${p.badgeClass} ${className}`}>
      <Icon size={12} aria-hidden /> {p.label}
    </span>
  );
}

export function UnitPhoto({ photoUrl, variant, className = "" }) {
  const small = variant === "compact" || variant === "plan";
  const size = variant === "plan" ? "h-[68px] w-[68px]" : variant === "compact" ? "h-16 w-16" : "h-28 w-full";
  return (
    <div className={`relative shrink-0 overflow-hidden bg-inset ${small ? "rounded-btn" : "rounded-t-card"} ${size} ${className}`}>
      {photoUrl
        ? <img src={photoUrl} alt="Foto unit" className="h-full w-full object-cover" loading="lazy" />
        : (
          <div data-testid="photo-empty" className="flex h-full w-full flex-col items-center justify-center gap-1 border border-dashed border-line text-ink3">
            <ImageOff size={small ? 18 : 26} aria-hidden />
            {!small && <span className="text-[12px] font-medium">Belum ada foto</span>}
          </div>
        )}
    </div>
  );
}

// Baris "Kasur: jenis · merk · ukuran" — SATU tempat untuk kartu Status/Rencana/QC/Akan Masuk. Bagian kosong dilewati; semua kosong = "belum tercatat".
export function MattressLine({ view }) {
  const m = mattressInfo(view);
  const parts = [m.jenis, m.merk, m.ukuran].filter(Boolean);
  return (
    <p data-testid="mattress-info" className="m-0 line-clamp-2 text-[13px] text-ink2" title={parts.join(" · ")}>
      <span className="font-semibold text-ink3">Kasur: </span>{parts.length ? parts.join(" · ") : <span className="text-ink3">belum tercatat</span>}
    </p>
  );
}

// Catatan Sales (kartu Status/QC/Akan Masuk). Ganti Kain = krusial: kotak peringatan oranye yang SELALU tampil (juga bila catatan kosong) supaya
// PIC memastikan kain sesuai keinginan customer sebelum mengerjakan. Kartu tetap berlatar normal; penanda = garis kiri oranye (GantiKainStripe).
export function SalesNote({ view }) {
  const note = salesNoteOf(view);
  if (isGantiKain(view)) {
    return (
      <div data-testid="ganti-kain-note" className="rounded-btn border border-orange bg-orangebg px-2.5 py-1.5">
        <p className="m-0 flex items-start gap-1.5 text-[12px] font-bold text-orange"><Scissors size={13} className="mt-px shrink-0" aria-hidden /> Ganti Kain — pastikan sesuai permintaan customer</p>
        {note
          ? <p data-testid="sales-note" className="m-0 mt-0.5 line-clamp-3 break-words text-[13px] font-medium text-ink [overflow-wrap:anywhere]" title={note}><span className="font-semibold text-ink3">Catatan Sales: </span>{note}</p>
          : <p className="m-0 mt-0.5 text-[12px] font-semibold text-orange">Catatan kain belum tersedia — konfirmasi ke Sales</p>}
      </div>
    );
  }
  if (!note) return null;
  return (
    <p data-testid="sales-note" className="m-0 line-clamp-2 break-words text-[13px] text-ink2 [overflow-wrap:anywhere]" title={note}>
      <span className="font-semibold text-ink3">Catatan Sales: </span><span className="italic">“{note}”</span>
    </p>
  );
}

// Garis kiri kartu (prioritas kanonis) + garis oranye tambahan untuk Ganti Kain. Elemen SENDIRI (bukan border kartu): aturan kaca global
// (.glass-division [class*="rounded-card"]) menimpa border kartu, sehingga border-left tidak pernah terlihat.
export function CardStripes({ priority, gantiKain }) {
  const p = priorityMeta(priority);
  return (
    <>
      <span aria-hidden data-testid="priority-stripe" className={`absolute inset-y-0 left-0 ${p.stripeClass}`} />
      {gantiKain && <span aria-hidden data-testid="ganti-kain-stripe" className="absolute inset-y-0 w-1 bg-orange" style={{ left: p.stripeWidth }} />}
    </>
  );
}

export function PicChips({ view }) {
  const t = view?.plan?.operator?.name, c = view?.plan?.cornerOperator?.name;
  if (!t && !c) return <span className="text-[12px] text-ink3">PIC belum ditetapkan</span>;
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-[12.5px] text-ink2">
      {t && <span className="inline-flex items-center gap-1" title={`PIC Table: ${t}`}><span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[11px] font-bold text-white">{initials(t)}</span>{t}</span>}
      {c && c !== t && <span className="inline-flex items-center gap-1" title={`PIC Corner: ${c}`}><span className="flex h-5 w-5 items-center justify-center rounded-full bg-bluesolid text-[11px] font-bold text-white">{initials(c)}</span>{c}</span>}
    </span>
  );
}

export function UnitCard({
  view, onOpen, footer = null, variant = "photo", today, tomorrow, showGaps = true, className = "", qcBadge = null, seq = null, showTechService = true,
}) {
  if (!view) return null;
  const c = view.customer || {};
  const p = priorityMeta(view.plan?.priority ?? 0);
  const st = bucketStyle(view.bucket);
  const dateBadge = today && tomorrow ? targetDateBadge(view, today, tomorrow) : null;
  const gaps = showGaps ? dataGaps(view) : [];
  const mat = materialBadge(view);
  const sales = c.salesServices?.length ? c.salesServices.join(" + ") : null;
  const gantiKain = isGantiKain(view);
  const progress = view.progress?.total ? (view.progress.done / view.progress.total) * 100 : 0;
  const open = () => onOpen?.(view);
  const station = view.plan?.stationCode ? mejaLabel(view.plan.stationCode) : "Belum dijadwalkan";

  const head = (
    <div className="min-w-0">
      <p data-testid="customer-name" className="m-0 line-clamp-2 break-words text-[16px] font-bold leading-tight text-ink [overflow-wrap:anywhere]" title={c.name || ""}>{c.name || "Pelanggan belum dicatat"}</p>
      <p className="m-0 mt-0.5 truncate text-[12px] text-ink3" title={`${view.unit.unitCode}${c.orderNumber ? ` · ${c.orderNumber}` : ""}${c.city ? ` · ${c.city}` : ""}`}>{view.unit.unitCode}{c.orderNumber ? ` · ${c.orderNumber}` : ""}{c.city ? ` · ${c.city}` : ""}</p>
    </div>
  );
  const body = (
    <div className="min-w-0 space-y-1.5 px-3 pb-3 pl-5">
      <p className="m-0 line-clamp-2 text-[13px] text-ink2" title={sales || ""}>
        <span className="font-semibold text-ink3">Layanan Sales: </span>{sales || <span className="text-ink3">belum tercatat</span>}
      </p>
      {showTechService && (
        <p data-testid="tech-service" className="m-0 line-clamp-1 text-[13px] text-ink2" title={view.unit.service?.label || ""}>
          <span className="font-semibold text-ink3">Layanan Teknis: </span>{view.unit.service?.label || <span className="text-ink3">belum ditetapkan (dari Diagnosis)</span>}
        </p>
      )}
      <MattressLine view={view} />
      <SalesNote view={view} />
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant={st.badge}>{st.label}</Badge>
        {view.next?.stepNo && <span className="text-[13px] font-medium text-ink2">{stageText(view)}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {dateBadge && <Badge variant={dateBadge.tone}>{dateBadge.label}</Badge>}
        {view.plan?.productionDate && <span className="inline-flex items-center gap-1 text-[12px] text-ink3"><CalendarDays size={12} aria-hidden /> Target {view.plan.productionDate}</span>}
        {view.plan && mat && <Badge variant={mat.tone}>{mat.label}</Badge>}
      </div>
      <div className="flex items-center justify-between gap-2"><PicChips view={view} /></div>
      {view.progress && (
        <div className="flex items-center gap-2">
          <div className="flex-1"><ProgressBar value={progress} variant={view.shortage ? "warning" : "accent"} /></div>
          <span className="shrink-0 text-[12px] text-ink3 tabular-nums">{view.progress.done}/{view.progress.total} tahap</span>
        </div>
      )}
      {qcBadge}
      {view.shortage && <p className="m-0 flex items-center gap-1 text-[12px] font-medium text-red"><PackageX size={12} aria-hidden /> Menunggu bahan: {view.shortage.items?.map((i) => i.name).join(", ")}</p>}
      {gaps.length > 0 && (
        <ul data-testid="data-gaps" className="m-0 flex list-none flex-wrap gap-1 p-0">
          {gaps.map((g) => <li key={g} className="inline-flex items-center gap-1 rounded-chip bg-orangebg px-1.5 py-0.5 text-[11.5px] font-medium text-orange"><AlertTriangle size={11} aria-hidden /> {g}</li>)}
        </ul>
      )}
    </div>
  );

  return (
    <article data-testid="unit-card" data-unit-code={view.unit.unitCode} data-priority={p.key} data-ganti-kain={gantiKain ? "true" : undefined}
      className={`relative w-full min-w-0 overflow-hidden rounded-card bg-surface shadow-sm ${view.bucket === "MENUNGGU_BAHAN" ? "ring-1 ring-orange/40" : ""} ${className}`}>
      <CardStripes priority={view.plan?.priority ?? 0} gantiKain={gantiKain} />
      <button type="button" onClick={open} className="block w-full text-left hover:bg-hovertint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent" aria-label={`Buka Unit 360 ${view.unit.unitCode}`}>
        {variant === "compact" ? (
          <>
            <div className="flex gap-3 p-3 pl-5">
              <UnitPhoto photoUrl={view.unit.photoUrl} variant="compact" />
              <div className="min-w-0 flex-1 space-y-1.5">
                {head}
                <div className="flex flex-wrap items-center gap-1.5">{seq != null && <span data-testid="seq" className="rounded-chip bg-accentbg px-2 py-0.5 text-[11.5px] font-bold text-accent">Urutan {seq}</span>}<PriorityTag priority={view.plan?.priority ?? 0} />{seq == null && <Badge variant="neutral">{station}</Badge>}</div>
              </div>
            </div>
            {body}
          </>
        ) : (
          <>
            <div className="relative">
              <UnitPhoto photoUrl={view.unit.photoUrl} variant="photo" />
              <div className="absolute left-2 top-2"><PriorityTag priority={view.plan?.priority ?? 0} /></div>
              <div className="absolute right-2 top-2"><span className="inline-flex items-center gap-1 rounded-chip bg-surface/95 px-2 py-0.5 text-[11.5px] font-semibold text-ink shadow-sm"><Wrench size={12} aria-hidden /> {station}</span></div>
            </div>
            <div className="px-3 pt-3 pl-5">{head}</div>
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
    <article data-testid="unit-card" data-unit-code={item.unit.unitCode} data-ganti-kain={isGantiKain(item) ? "true" : undefined} className="relative w-full min-w-0 overflow-hidden rounded-card bg-surface shadow-sm">
      <CardStripes priority={0} gantiKain={isGantiKain(item)} />
      <button type="button" onClick={() => onOpen?.(item.unit.id)} className="block w-full text-left hover:bg-hovertint" aria-label={`Buka Unit 360 ${item.unit.unitCode}`}>
        <UnitPhoto photoUrl={item.unit.photoUrl} variant="photo" />
        <div className="space-y-1.5 p-3 pl-5">
          <p data-testid="customer-name" className="m-0 line-clamp-2 break-words text-[16px] font-bold leading-tight text-ink [overflow-wrap:anywhere]" title={c.name || ""}>{c.name || "Pelanggan belum dicatat"}</p>
          <p className="m-0 truncate text-[12px] text-ink3">{item.unit.unitCode}{item.unit.orderNumber ? ` · ${item.unit.orderNumber}` : ""}{c.city ? ` · ${c.city}` : ""}</p>
          <p className="m-0 line-clamp-2 text-[13px] text-ink2"><span className="font-semibold text-ink3">Layanan Sales: </span>{c.salesServices?.length ? c.salesServices.join(" + ") : <span className="text-ink3">belum tercatat</span>}</p>
          <MattressLine view={item} />
          <SalesNote view={item} />
          <div className="flex flex-wrap items-center gap-1.5"><Badge variant="neutral">{badgeLabel}</Badge>{item.scheduledDate && <span className="text-[12px] text-ink3">Pickup {item.scheduledDate}</span>}{item.driverName && <span className="text-[12px] text-ink3">· {item.driverName}</span>}</div>
          {!item.unit.photoUrl && <ul data-testid="data-gaps" className="m-0 flex list-none flex-wrap gap-1 p-0"><li className="inline-flex items-center gap-1 rounded-chip bg-orangebg px-1.5 py-0.5 text-[11.5px] font-medium text-orange"><AlertTriangle size={11} aria-hidden /> Foto unit belum ada</li></ul>}
        </div>
      </button>
      {footer && <div className="border-t border-line px-3 py-2">{footer}</div>}
    </article>
  );
}
