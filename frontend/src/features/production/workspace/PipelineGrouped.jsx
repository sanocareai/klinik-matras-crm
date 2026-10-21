import React from "react";
import { AlertTriangle, Truck } from "lucide-react";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Card } from "@/components/ui/card.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { cn } from "@/lib/utils.js";
import { targetDateBadge } from "@/features/production/experience.js";
import { PicChips } from "@/features/production/UnitCard.jsx";
import { stageText } from "@/features/production/unitCardModel.js";
import { Penanda } from "@/features/production/workspace/StatusMarkers.jsx";
import { badgeTarget } from "@/features/production/workspace/workListModel.js";
import { LayoutGrid } from "lucide-react";

// PIPELINE (tampilan pilihan): tahap dikelompokkan jadi beberapa lajur — kolom tahap yang kosong tidak ditampilkan dan tidak memaksa scroll mendatar.
// Kartu padat: pelanggan, kode unit, tahap Meja, target, PIC. Klik kartu membuka Ruang Kerja Unit yang SAMA dengan Daftar.
// Unit yang sudah Terkirim/Dibatalkan TIDAK ditampilkan sebagai tahap aktif (dilaporkan terpisah di bawah).

function KartuMeja({ item, today, tomorrow, onBuka, onTerima }) {
  const c = item.customer || {}; const t = targetDateBadge(item, today, tomorrow); const tahap = stageText(item);
  return (
    <li className="min-w-0" data-testid="pipeline-kartu" data-unit-code={item.unit.unitCode}>
      <div className="rounded-btn bg-surface shadow-sm">
        <button type="button" onClick={() => onBuka(item.unit.id)} aria-label={`Buka ruang kerja ${item.unit.unitCode}`} className="block w-full min-w-0 rounded-btn px-3 py-2.5 text-left outline-none hover:bg-hovertint focus-visible:ring-2 focus-visible:ring-accent/50">
          <span className="block truncate text-[13.5px] font-semibold text-ink">{c.name || "Pelanggan belum dicatat"}</span>
          <span className="block truncate text-[12px] text-ink3">{item.unit.unitCode}{c.orderNumber ? ` · ${c.orderNumber}` : ""}</span>
          <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Penanda jenis="meja" nilai={[item.__tahap, item.plan?.stationCode ? String(item.plan.stationCode).replace("TABLE_", "Meja ") : null].filter(Boolean).join(" · ") || "Di alur Meja"} nada="accent" padat />
            {t && <Badge variant={t.tone}>{t.label}</Badge>}
          </span>
          {tahap && <span className="mt-1 block truncate text-[12px] text-ink2">{tahap}</span>}
          <span className="mt-1 block text-[12px]"><PicChips view={item} /></span>
        </button>
        {onTerima && item.bucket === "DALAM_PERJALANAN" && (
          <div className="border-t border-line px-2 py-1.5"><Button type="button" size="sm" variant="secondary" className="min-h-[44px] w-full" data-mutates onClick={() => onTerima(item)}><Truck size={13} aria-hidden /> Terima Unit di Workshop</Button></div>
        )}
      </div>
    </li>
  );
}

function KartuBelumMeja({ unit, onBuka }) {
  const tg = badgeTarget(unit.targetSelesai?.at);
  return (
    <li className="min-w-0" data-testid="pipeline-kartu" data-unit-code={unit.unitCode}>
      <button type="button" onClick={() => onBuka(unit.id)} aria-label={`Buka ruang kerja ${unit.unitCode}`} className="block w-full min-w-0 rounded-btn bg-surface px-3 py-2.5 text-left shadow-sm outline-none hover:bg-hovertint focus-visible:ring-2 focus-visible:ring-accent/50">
        <span className="block truncate text-[13.5px] font-semibold text-ink">{unit.pelanggan}</span>
        <span className="block truncate text-[12px] text-ink3">{unit.unitCode}{unit.orderNumber ? ` · ${unit.orderNumber}` : ""}</span>
        <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Penanda jenis="kerja" nilai={unit.kerja?.label ?? "—"} nada={unit.kerja?.tone} padat />
          {tg.ada && <Badge variant={tg.nada}>{tg.teks}</Badge>}
        </span>
        <span className="mt-1 block truncate text-[12px] text-ink3">{unit.posisi?.label}</span>
      </button>
    </li>
  );
}

export default function PipelineGrouped({ kelompok, today, tomorrow, onBuka, onTerima, belumMejaTotal = 0, onKeDaftar }) {
  if (!kelompok.lajur.length && !kelompok.tertinggal.length) {
    return <Card className="p-0"><EmptyState icon={LayoutGrid} title="Belum ada unit di jalur" description="Unit muncul di sini setelah dijadwalkan di Rencana Produksi atau dikerjakan lewat pencatatan Admin." /></Card>;
  }
  return (
    <div className="space-y-4" data-testid="pipeline-grup">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5">
        {kelompok.lajur.map((l) => {
          const tahap = [...new Set(l.items.map((i) => i.__tahap).filter(Boolean))];
          return (
            <section key={l.key} aria-label={l.label} data-testid="pipeline-lajur" data-lajur={l.key} className="min-w-0 rounded-card bg-inset p-2.5">
              <div className="mb-2 flex items-center justify-between gap-2 px-1">
                <h3 className="m-0 text-[13.5px] font-bold text-ink">{l.label}</h3>
                <span className="rounded-chip bg-surface px-2 py-0.5 text-[12px] font-bold tabular-nums text-ink2">{l.key === "BELUM_MEJA" && belumMejaTotal > l.items.length ? `${l.items.length}/${belumMejaTotal}` : l.items.length}</span>
              </div>
              {tahap.length > 1 && <p className="m-0 mb-2 px-1 text-[11.5px] text-ink3">{tahap.join(" · ")}</p>}
              {l.catatan && <p className="m-0 mb-2 px-1 text-[11.5px] text-ink3">{l.catatan}</p>}
              <ul className="m-0 list-none space-y-2 p-0">
                {l.items.map((it) => (l.key === "BELUM_MEJA"
                  ? <KartuBelumMeja key={it.id} unit={it} onBuka={onBuka} />
                  : <KartuMeja key={it.runId || it.unit.id} item={it} today={today} tomorrow={tomorrow} onBuka={onBuka} onTerima={onTerima} />))}
              </ul>
              {l.key === "BELUM_MEJA" && belumMejaTotal > l.items.length && <Button type="button" variant="tertiary" size="sm" className="mt-2 min-h-[44px] w-full" onClick={onKeDaftar}>Lihat semua {belumMejaTotal} di Daftar</Button>}
            </section>
          );
        })}
      </div>
      {kelompok.tertinggal.length > 0 && (
        <p role="note" data-testid="pipeline-tertinggal" className={cn("m-0 flex items-start gap-2 rounded-btn bg-orangebg px-3 py-2.5 text-[12.5px] text-orange")}>
          <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
          {kelompok.tertinggal.length} unit sudah Terkirim/Dibatalkan tetapi pekerjaan di alur Meja belum ditutup — tidak ditampilkan sebagai tahap aktif ({kelompok.tertinggal.map((i) => i.unit.unitCode).join(", ")}). Minta Kepala Produksi meninjaunya.
        </p>
      )}
    </div>
  );
}
