import React from "react";
import { AlertTriangle, CalendarDays, ChevronsUp, Flame, GripVertical, Lock, PackageX, Scissors } from "lucide-react";
import { Badge } from "@/components/ui/badge.jsx";
import { ProgressBar } from "@/components/ui/progress.jsx";
import { targetDateBadge } from "@/features/production/experience.js";
import { dataGaps, isGantiKain, materialBadge, mattressInfo, mejaLabel, priorityMeta, salesNoteOf, stageText } from "@/features/production/unitCardModel.js";
import { isPlanComplete } from "@/features/production/planDnd.js";
import { delayStatusText, progressText, rankOfView, viewPresence, viewStatus } from "@/features/production/productionLabels.js";
import { UnitPhoto } from "@/features/production/UnitCard.jsx";
import { formatTanggal } from "@/utils/formatDate.js";
import PkrRujukan from "@/features/production/PkrRujukan.jsx";

// P12A.2 — kartu RENCANA PRODUKSI (backlog + slot meja). Hierarki: header (foto, nama customer, order/unit, prioritas) → tiga blok informasi berbeda
// (Layanan Sales biru · Kasur netral · Catatan Sales kuning lembut) → operasional (tahap, bahan, target, meja/urutan, PIC, progres).
// TANPA harga (harga hanya di Unit 360 untuk role berizin). Tata letak dua kolom di kartu lebar (container query), satu kolom di backlog/tablet/HP.

// Handle seret — SATU-SATUNYA bagian kartu yang menangkap sentuhan (touch-action:none): di luar handle halaman tetap bisa digulir dan ketukan
// kartu membuka Unit 360. Target 44px. Tidak ber-`data-mutates`: di Mode Demo seret berjalan sebagai simulasi client-only (tanpa jaringan).
export function DragHandle({ unitCode, onPointerDown, disabled = false }) {
  return (
    <button type="button" data-testid="drag-handle" disabled={disabled} aria-label={`Seret ${unitCode} untuk memindahkan`} title="Tahan lalu seret"
      onPointerDown={onPointerDown} onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()} style={{ touchAction: "none" }}
      className="flex h-11 w-11 select-none items-center justify-center rounded-btn border border-line bg-surface text-ink2 shadow-sm hover:bg-hovertint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50 enabled:cursor-grab enabled:active:cursor-grabbing">
      <GripVertical size={20} aria-hidden />
    </button>
  );
}

function PriorityBadge({ meta }) {
  const Icon = meta.icon === "urgent" ? Flame : meta.icon === "high" ? ChevronsUp : null;
  return (
    <span data-testid="priority-tag" data-priority={meta.key} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-chip px-2 py-0.5 text-[11.5px] font-bold uppercase tracking-wide ${meta.badgeClass}`}>
      {Icon && <Icon size={12} aria-hidden />}{meta.label}
    </span>
  );
}

function Block({ kind, label, aside = null, testid, clamp = "line-clamp-3", title, children }) {
  return (
    <div data-testid={testid} className={`plan-block plan-block-${kind} min-w-0`}>
      <p className="m-0 flex items-baseline justify-between gap-2 text-[12px] font-bold uppercase tracking-wide text-ink2"><span>{label}</span>{aside}</p>
      <div className={`mt-0.5 break-words text-[13.5px] leading-snug text-ink [overflow-wrap:anywhere] ${clamp}`} title={title}>{children}</div>
    </div>
  );
}
const Empty = ({ children }) => <span className="italic text-ink3">{children}</span>;

function Row({ label, children, testid }) {
  return (
    <div data-testid={testid} className="flex min-w-0 items-baseline gap-2 text-[13px]">
      <span className="w-[72px] shrink-0 text-[12px] font-semibold text-ink3">{label}</span>
      <span className="min-w-0 flex-1 break-words text-ink2 [overflow-wrap:anywhere]">{children}</span>
    </div>
  );
}

export function PlanCard({ view, seq = null, today, tomorrow, onOpen, handle = null, footer = null, dragging = false }) {
  if (!view) return null;
  const c = view.customer || {};
  const plan = view.plan || null;
  const p = priorityMeta(rankOfView(view));
  const status = viewStatus(view);
  const presence = viewPresence(view);
  const gantiKain = isGantiKain(view);
  const complete = isPlanComplete(view);
  const m = mattressInfo(view);
  const kasurParts = [m.jenis, m.merk, m.ukuran].filter(Boolean);
  const kasurIncomplete = kasurParts.length < 3;
  const note = salesNoteOf(view);
  const sales = c.salesServices?.length ? c.salesServices.join(" + ") : null;
  const mat = plan ? materialBadge(view) : null;
  const dateBadge = today && tomorrow ? targetDateBadge(view, today, tomorrow) : null;
  const scheduled = !!plan?.stationCode;
  const progress = view.progress?.total ? (view.progress.done / view.progress.total) * 100 : 0;
  const tablePic = plan?.operator?.name || null;
  const cornerPic = plan?.cornerOperator?.name || null;
  const gaps = dataGaps(view).filter((g) => !/Layanan Sales/.test(g) && !(g.startsWith("PIC meja") && !scheduled));
  const open = () => onOpen?.(view);
  const showHandle = !complete && handle;

  return (
    <article data-testid="unit-card" data-card="plan" data-drag-card data-unit-code={view.unit.unitCode} data-priority={p.key} data-ganti-kain={gantiKain ? "true" : undefined} data-complete={complete ? "true" : undefined}
      className={`@container relative w-full min-w-0 shrink-0 overflow-hidden rounded-card bg-surface shadow-sm ${view.bucket === "MENUNGGU_BAHAN" ? "ring-1 ring-orange/40" : ""} ${complete ? "opacity-60" : ""} ${dragging ? "opacity-40" : ""}`}>
      <span aria-hidden data-testid="priority-stripe" className={`absolute inset-y-0 left-0 ${p.stripeClass}`} />
      {gantiKain && <span aria-hidden data-testid="ganti-kain-stripe" className="absolute inset-y-0 w-1 bg-orange" style={{ left: p.stripeWidth }} />}
      {showHandle && <div className="absolute right-2 top-2 z-10">{handle}</div>}
      {complete && <span data-testid="locked-mark" title="Unit 12/12 — terkunci" className="absolute right-3 top-3 z-10 text-ink3"><Lock size={18} aria-hidden /></span>}

      <button type="button" onClick={open} aria-label={`Buka Unit 360 ${view.unit.unitCode}`} className="block w-full min-w-0 text-left hover:bg-hovertint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">
        {/* Header */}
        <div className="flex min-w-0 items-start gap-3 py-3 pl-5 pr-14">
          <UnitPhoto photoUrl={view.unit.photoUrl} variant="plan" />
          <div className="min-w-0 flex-1">
            <p data-testid="customer-name" className="m-0 line-clamp-2 break-words text-[16px] font-bold leading-tight text-ink [overflow-wrap:anywhere]" title={c.name || ""}>{c.name || "Pelanggan belum dicatat"}</p>
            <p className="m-0 mt-0.5 truncate text-[12.5px] text-ink3" title={`${view.unit.unitCode}${c.orderNumber ? ` · ${c.orderNumber}` : ""}`}>{view.unit.unitCode}{c.orderNumber ? ` · ${c.orderNumber}` : ""}{c.city ? ` · ${c.city}` : ""}</p>
            <PkrRujukan pkr={view.penjualanKaryawan} className="mt-1" />
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <PriorityBadge meta={p} />
              {view.plan?.targetMissed ? <Badge variant="red" data-testid="missed-target-badge">Lewat Target</Badge> : view.timer?.late && <Badge variant="red">Terlambat</Badge>}
              {complete && <span data-testid="complete-chip" className="inline-flex items-center gap-1 rounded-chip bg-inset px-2 py-0.5 text-[11.5px] font-bold text-ink2"><Lock size={12} aria-hidden /> Selesai 12/12 · terkunci</span>}
            </div>
          </div>
        </div>

        {/* Isi: dua kolom di kartu lebar, satu kolom di backlog/tablet/HP */}
        <div className="grid min-w-0 gap-3 pb-3 pl-5 pr-3 @[34rem]:grid-cols-2">
          <div className="min-w-0 space-y-2">
            <Block kind="sales" label="Layanan Sales" testid="block-sales" clamp="line-clamp-3" title={sales || undefined}>{sales || <Empty>Layanan belum dicatat Sales</Empty>}</Block>
            <Block kind="kasur" label="Kasur" testid="mattress-info" clamp="line-clamp-2" title={kasurParts.join(" · ") || undefined}>
              {kasurParts.length ? kasurParts.join(" · ") : <Empty>Data kasur belum lengkap</Empty>}
              {kasurParts.length > 0 && kasurIncomplete && <span className="mt-0.5 block text-[12px] text-ink3">Data kasur belum lengkap</span>}
            </Block>
            <Block kind="note" label="Catatan Sales" testid="block-note" clamp="line-clamp-4" title={note || undefined} aside={c.salesName ? <span className="normal-case font-semibold tracking-normal text-ink3" data-testid="sales-name">Sales: {c.salesName}</span> : null}>
              {note ? <span data-testid="sales-note" title={note}>{note}</span> : <Empty>Catatan Sales belum tersedia</Empty>}
            </Block>
            {gantiKain && (
              <div data-testid="ganti-kain-note" className="rounded-btn border border-orange bg-orangebg px-2.5 py-1.5">
                <p className="m-0 flex items-start gap-1.5 text-[13px] font-bold text-orange"><Scissors size={14} className="mt-px shrink-0" aria-hidden /> Ganti Kain — pastikan sesuai permintaan customer</p>
                {!note && <p className="m-0 mt-0.5 text-[12.5px] font-semibold text-orange">Catatan kain belum tersedia — konfirmasi ke Sales</p>}
              </div>
            )}
          </div>

          <div className="min-w-0 space-y-1.5" data-testid="plan-ops">
            <Row label="Status" testid="row-status"><Badge variant={status.tone}>{status.label}</Badge>{status.detail && <span className="ml-1.5 text-[12px] text-ink3">{status.detail}</span>}</Row>
            {presence && <Row label="Posisi" testid="row-presence"><span className={presence.key === "NOT_ARRIVED" ? "font-semibold text-orange" : ""}>{presence.label}</span></Row>}
            <Row label="Tahap" testid="row-stage">{stageText(view)}</Row>
            <Row label="Bahan" testid="row-material">{mat ? <Badge variant={mat.tone}>{mat.label}</Badge> : <span className="text-ink3">—</span>}</Row>
            <Row label="Target" testid="row-target">
              {plan?.productionDate ? (
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  <CalendarDays size={12} aria-hidden /> {formatTanggal(plan.targetEffective || plan.productionDate)}
                  {plan.targetIsException && <span data-testid="target-exception" className="rounded-chip bg-inset px-1.5 py-0.5 text-[11px] font-semibold text-ink2" title={`Tanggal papan ${formatTanggal(plan.productionDate)}; target khusus untuk order ini`}>Target khusus</span>}
                  {dateBadge && <Badge variant={dateBadge.tone}>{dateBadge.label}</Badge>}
                </span>
              ) : <span className="text-ink3">Belum dijadwalkan</span>}
            </Row>
            <Row label="Meja" testid="row-station">{scheduled ? <b className="text-ink">{mejaLabel(plan.stationCode)}{seq != null ? ` · Urutan ${seq}` : ""}</b> : <span className="text-ink3">Belum dijadwalkan</span>}</Row>
            <Row label={scheduled ? "PIC" : "PIC usulan"} testid="row-pic">
              {scheduled
                ? ((tablePic || cornerPic) ? <>{tablePic && <span>Table: {tablePic}</span>}{tablePic && cornerPic && <br />}{cornerPic && <span>Corner: {cornerPic}</span>}</> : <span className="text-ink3">PIC belum ditetapkan</span>)
                : ((tablePic || cornerPic) ? <span title="Usulan awal — belum final sampai dijadwalkan">{[tablePic && `Table: ${tablePic}`, cornerPic && `Corner: ${cornerPic}`].filter(Boolean).join(" · ")} <span className="text-ink3">(usulan)</span></span> : <span className="text-ink3">Belum ada usulan</span>)}
            </Row>
            {view.progress && (
              <div className="flex items-center gap-2 pt-0.5" data-testid="row-progress">
                <div className="flex-1"><ProgressBar value={progress} variant={view.shortage ? "warning" : "accent"} /></div>
                <span className="shrink-0 text-[12.5px] font-semibold tabular-nums text-ink2">{progressText(view.progress)}</span>
              </div>
            )}
            {view.shortage && <p data-testid="delay-status" className="m-0 flex items-center gap-1 text-[12.5px] font-medium text-red"><PackageX size={13} aria-hidden /> {delayStatusText("MATERIAL_SHORTAGE")}: {view.shortage.items?.map((i) => i.name).join(", ")}</p>}
            {gaps.length > 0 && (
              <ul data-testid="data-gaps" className="m-0 flex list-none flex-wrap gap-1 p-0">
                {gaps.map((g) => <li key={g} className="inline-flex items-center gap-1 rounded-chip bg-orangebg px-1.5 py-0.5 text-[11.5px] font-medium text-orange"><AlertTriangle size={11} aria-hidden /> {g}</li>)}
              </ul>
            )}
          </div>
        </div>
      </button>
      {footer && <div className="border-t border-line px-3 py-2 pl-5">{footer}</div>}
    </article>
  );
}
