import React from "react";
import { ArrowRight, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge.jsx";
import { NOT_RECORDED, OUTCOME_LABEL } from "./componentNotesModel.js";

// Ringkasan “Sebelum → Sesudah” dari perbandingan SERVER (satu sumber untuk Meja, Corner, Dokumentasi, Unit 360, laporan). Data yang belum dicatat tampil “Belum dicatat”
// (tidak dikarang); komponen yang tetap digunakan diberi tanda hijau. Tahap yang dilewati tidak pernah menghasilkan baris di sini.
const TONE = { KEPT: "green", REPAIRED: "orange", REPLACED: "accent", UNRECORDED: "neutral", NOT_IN_FINAL: "neutral" };
const Missing = () => <span className="italic text-ink3" data-testid="not-recorded">{NOT_RECORDED}</span>;

function BeforeCell({ before, recorded }) {
  if (!before) return recorded === false ? <Missing /> : <span className="italic text-ink3">—</span>;
  return (
    <div className="min-w-0 space-y-0.5">
      <p className="m-0 break-words font-semibold text-ink [overflow-wrap:anywhere]">{before.material || before.systemLabel || "—"}</p>
      <p className="m-0 text-[12px] text-ink3">{[before.systemLabel && before.material ? before.systemLabel : null, before.thicknessCm ? `${before.thicknessCm} cm` : null, before.conditionLabel].filter(Boolean).join(" · ")}</p>
      {before.note && <p className="m-0 break-words text-[12px] text-ink3 [overflow-wrap:anywhere]">“{before.note}”</p>}
    </div>
  );
}
function AfterCell({ final, outcome, actionLabel, afterNote }) {
  if (!final) return outcome === "NOT_IN_FINAL" ? <span className="text-ink3">{OUTCOME_LABEL.NOT_IN_FINAL}</span> : <Missing />;
  return (
    <div className="min-w-0 space-y-1">
      <p className="m-0 break-words font-semibold text-ink [overflow-wrap:anywhere]">{final.label}{final.thicknessCm ? ` · ${final.thicknessCm} cm` : ""}</p>
      <Badge variant={TONE[outcome] || "neutral"} data-testid="outcome-badge" data-outcome={outcome}>{outcome === "KEPT" ? OUTCOME_LABEL.KEPT : actionLabel || OUTCOME_LABEL[outcome]}</Badge>
      {afterNote && <p className="m-0 break-words text-[12px] text-ink3 [overflow-wrap:anywhere]">“{afterNote}”</p>}
    </div>
  );
}
function Row({ title, row, testid }) {
  return (
    <li className="rounded-btn bg-inset p-3" data-testid={testid} data-outcome={row.outcome}>
      <p className="m-0 mb-1.5 text-[12px] font-bold uppercase tracking-wide text-ink3">{title}</p>
      <div className="grid gap-2 text-[13.5px] sm:grid-cols-[1fr_auto_1fr] sm:items-start">
        <div><p className="m-0 mb-0.5 text-[11px] text-ink3">Sebelum</p><BeforeCell before={row.before} recorded={row.beforeRecorded} /></div>
        <ArrowRight size={16} className="mt-5 hidden text-ink3 sm:block" aria-hidden />
        <div><p className="m-0 mb-0.5 text-[11px] text-ink3">Sesudah</p><AfterCell final={row.final} outcome={row.outcome} actionLabel={row.actionLabel} afterNote={row.afterNote} /></div>
      </div>
    </li>
  );
}

export function BeforeAfterSummary({ comparison }) {
  if (!comparison) return null;
  const { gaps = [], foundation, layers = [], kept = [] } = comparison;
  return (
    <div className="space-y-2.5" data-testid="before-after" data-complete={comparison.complete ? "1" : "0"}>
      {gaps.length > 0 && (
        <div className="flex items-start gap-2 rounded-btn bg-orangebg px-3 py-2 text-[12.5px] text-orange" data-testid="before-after-gaps">
          <Info size={14} className="mt-px shrink-0" aria-hidden />
          <ul className="m-0 list-none space-y-0.5 p-0">{gaps.map((g) => <li key={g.section}>{g.text}</li>)}</ul>
        </div>
      )}
      {!comparison.recordedAny && <p className="m-0 text-[13px] text-ink3" data-testid="before-after-empty">Belum ada catatan komponen untuk unit ini.</p>}
      {(foundation || layers.length > 0) && (
        <ul className="m-0 list-none space-y-2 p-0">
          {foundation && <Row title="Fondasi" row={foundation} testid="ba-foundation" />}
          {layers.map((l, i) => <Row key={`${l.order}-${i}`} title={`Lapisan ${l.order}`} row={l} testid="ba-layer" />)}
        </ul>
      )}
      {kept.length > 0 && (
        <p className="m-0 rounded-btn bg-greenbg px-3 py-2 text-[12.5px] text-green" data-testid="ba-kept"><b>Tetap digunakan:</b> {kept.join("; ")}</p>
      )}
    </div>
  );
}
