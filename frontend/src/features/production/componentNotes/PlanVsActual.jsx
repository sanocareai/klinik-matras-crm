import React from "react";
import { Badge } from "@/components/ui/badge.jsx";
import { NOT_RECORDED } from "./componentNotesModel.js";

// Racikan RENCANA vs hasil AKTUAL (Fase 3 LAYANAN). Dua catatan terpisah dari satu sumber (Catatan Komponen: Racikan rencana vs Sesudah pengerjaan); perbandingan hanya bila keduanya tercatat.
// Lapisan dari atas ke bawah; total tinggi dihitung dari ketebalan yang diketahui ("belum lengkap" bila ada yang kosong). Ketebalan yang diwarisi dari catatan awal diberi tanda.
const DIFF_LABEL = { TINDAKAN: "tindakan berbeda", BAHAN: "bahan berbeda", KETEBALAN: "tebal berbeda" };
const STATUS_TONE = { SAMA: "green", BERBEDA: "orange", HANYA_RENCANA: "neutral", HANYA_AKTUAL: "neutral" };
const STATUS_TEXT = { SAMA: "Sesuai rencana", BERBEDA: "Berbeda dari rencana", HANYA_RENCANA: "Hanya di rencana", HANYA_AKTUAL: "Tidak direncanakan" };

const Cell = ({ item, label }) => (
  <div className="min-w-0" data-testid={`pva-${label}`}>
    <p className="m-0 text-[11px] text-ink3">{label === "rencana" ? "Rencana" : "Aktual"}</p>
    {item ? (
      <>
        <p className="m-0 break-words font-semibold text-ink [overflow-wrap:anywhere]">{item.label}{item.thicknessCm ? ` · ${item.thicknessCm} cm${item.thicknessSource === "DARI_CATATAN_AWAL" ? " (dari catatan awal)" : ""}` : ""}</p>
        <p className="m-0 text-[12px] text-ink3">{item.actionLabel}</p>
      </>
    ) : <p className="m-0 italic text-ink3">—</p>}
  </div>
);

function ResultList({ view, title, testid }) {
  if (!view) return <div className="rounded-btn bg-inset px-3 py-2 text-[13px]" data-testid={testid}><p className="m-0 font-bold text-ink">{title}</p><p className="m-0 text-ink3">{NOT_RECORDED}</p></div>;
  return (
    <div className="space-y-1 rounded-btn bg-inset px-3 py-2 text-[13px] text-ink2" data-testid={testid}>
      <p className="m-0 font-bold text-ink">{title} · versi {view.version}</p>
      {view.foundation && <p className="m-0" data-testid={`${testid}-foundation`}>Fondasi: {view.foundation.actionLabel} — {view.foundation.label}</p>}
      <ol className="m-0 list-none space-y-0.5 p-0" data-testid={`${testid}-layers`}>
        {view.layers.map((l) => <li key={l.order} className="break-words [overflow-wrap:anywhere]"><b>{l.order}.</b> {l.actionLabel} — {l.label}{l.thicknessCm ? ` · ${l.thicknessCm} cm${l.thicknessSource === "DARI_CATATAN_AWAL" ? " (dari catatan awal)" : ""}` : " · tebal belum dicatat"}</li>)}
      </ol>
      <p className="m-0 font-semibold text-ink" data-testid={`${testid}-total`}>{view.summary?.label}</p>
    </div>
  );
}

export function PlanVsActual({ comparison }) {
  if (!comparison || (!comparison.plan && !comparison.actual)) return null;
  const pva = comparison.planVsActual;
  return (
    <section className="space-y-2" aria-label="Rencana vs aktual" data-testid="plan-vs-actual">
      <p className="m-0 text-[13px] font-bold text-ink">Racikan rencana vs hasil aktual</p>
      <ResultList view={comparison.plan} title="Racikan rencana" testid="pva-plan" />
      <ResultList view={comparison.actual} title="Hasil aktual (sesudah pengerjaan)" testid="pva-actual" />
      {pva && !pva.available && <p className="m-0 rounded-btn bg-orangebg px-3 py-2 text-[12.5px] text-orange" data-testid="pva-unavailable">{pva.reason}</p>}
      {pva?.available && (
        <>
          <ul className="m-0 list-none space-y-2 p-0" data-testid="pva-rows">
            {pva.foundation && (
              <li className="rounded-btn bg-inset p-3" data-testid="pva-foundation-row" data-status={pva.foundation.status}>
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2"><p className="m-0 text-[12px] font-bold uppercase tracking-wide text-ink3">Fondasi</p>
                  <Badge variant={STATUS_TONE[pva.foundation.status]}>{STATUS_TEXT[pva.foundation.status]}{pva.foundation.diffs.length ? ` — ${pva.foundation.diffs.map((d) => DIFF_LABEL[d]).join(", ")}` : ""}</Badge></div>
                <div className="grid gap-2 text-[13.5px] sm:grid-cols-2"><Cell item={pva.foundation.plan} label="rencana" /><Cell item={pva.foundation.actual} label="aktual" /></div>
              </li>
            )}
            {pva.layers.map((r) => (
              <li key={r.order} className="rounded-btn bg-inset p-3" data-testid="pva-layer-row" data-status={r.status}>
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2"><p className="m-0 text-[12px] font-bold uppercase tracking-wide text-ink3">Lapisan {r.order}</p>
                  <Badge variant={STATUS_TONE[r.status]}>{STATUS_TEXT[r.status]}{r.diffs.length ? ` — ${r.diffs.map((d) => DIFF_LABEL[d]).join(", ")}` : ""}</Badge></div>
                <div className="grid gap-2 text-[13.5px] sm:grid-cols-2"><Cell item={r.plan} label="rencana" /><Cell item={r.actual} label="aktual" /></div>
              </li>
            ))}
          </ul>
          <p className="m-0 rounded-btn bg-inset px-3 py-2 text-[13px] font-semibold text-ink" data-testid="pva-total">
            Total tinggi lapisan — rencana {pva.total.planCm != null ? `${pva.total.planCm} cm${pva.total.planComplete ? "" : " (belum lengkap)"}` : NOT_RECORDED} · aktual {pva.total.actualCm != null ? `${pva.total.actualCm} cm${pva.total.actualComplete ? "" : " (belum lengkap)"}` : NOT_RECORDED}
            {pva.total.differenceCm != null ? ` · selisih ${pva.total.differenceCm > 0 ? "+" : ""}${pva.total.differenceCm} cm` : ""}
          </p>
        </>
      )}
    </section>
  );
}
