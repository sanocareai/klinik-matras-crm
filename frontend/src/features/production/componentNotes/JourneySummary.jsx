import React from "react";
import { Badge } from "@/components/ui/badge.jsx";
import { NOT_RECORDED } from "./componentNotesModel.js";

// Perjalanan unit (Fase 4 LAYANAN): KONDISI AWAL → RACIKAN → HASIL AKHIR dalam satu ringkasan. SATU sumber (Catatan Komponen; `measurements` + `comparison` dari endpoint yang sama) dipakai di
// Meja, Aplikasi PIC QC, Dokumentasi, Unit 360, dan laporan. Data kosong = "Belum dicatat". Penurunan kasur utuh dan fondasi TIDAK dijumlahkan; tanpa label "amblas" otomatis;
// perbandingan uji awal vs setelah perbaikan memakai teks server (hanya "sebanding" bila metode ditandai sama dan berat setara).
const NB = <span className="italic text-ink3" data-testid="not-recorded">{NOT_RECORDED}</span>;
const Row = ({ label, children, testid }) => (<div className="flex items-start justify-between gap-3 border-t border-line py-1.5 text-[13px] first:border-t-0" data-testid={testid}><span className="shrink-0 text-ink3">{label}</span><span className="min-w-0 text-right font-semibold text-ink [overflow-wrap:anywhere]">{children}</span></div>);
const Stage = ({ n, title, children, testid }) => (
  <section className="rounded-btn bg-inset p-3" data-testid={testid}>
    <p className="m-0 mb-1 flex items-center gap-2 text-[13.5px] font-bold text-ink"><span aria-hidden className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-[12px] text-white">{n}</span>{title}</p>
    {children}
  </section>
);
const cm = (v) => (v == null ? null : `${v} cm`);

export function JourneySummary({ data, compact = false }) {
  if (!data) return null;
  const m = data.measurements || {}; const c = data.comparison || {}; const s = data.sections || {};
  const anything = m.whole || m.foundation || m.layers || c.plan || c.actual || m.wholeAfter || m.foundationAfter;
  if (!anything) return null;
  const plan = c.plan; const actual = c.actual; const pva = c.planVsActual;
  const fdn = (v) => (v?.foundation ? `${v.foundation.actionLabel} — ${v.foundation.label}` : null);
  const verdict = m.wholeAfter?.complaintMatch ?? s.WHOLE_TEST_AFTER?.data?.complaintMatch;
  return (
    <section className="space-y-2" aria-label="Kondisi awal, racikan, dan hasil akhir" data-testid="journey-summary">
      <p className="m-0 text-[13px] font-bold text-ink">Kondisi awal → racikan → hasil akhir</p>
      <Stage n="1" title="Kondisi awal" testid="journey-awal">
        <Row label="Kasur utuh">{m.whole ? `turun ${cm(m.whole.wholeDropCm)} · ${m.whole.testerWeightKg} kg` : NB}</Row>
        <Row label="Fondasi">{m.foundation ? `${m.foundation.unloadedHeightCm} → ${m.foundation.loadedHeightCm} cm · turun ${cm(m.foundation.dropCm)}` : NB}</Row>
        <Row label="Lapisan awal">{m.layers ? m.layers.label : NB}</Row>
        {m.whole?.feelNote && !compact && <Row label="Feel awal">{m.whole.feelNote}</Row>}
      </Stage>
      <Stage n="2" title="Racikan rencana" testid="journey-racikan">
        <Row label="Fondasi">{plan ? (fdn(plan) || "Tidak ada perubahan fondasi dicatat") : NB}</Row>
        <Row label="Lapisan">{plan ? (plan.layers.length ? plan.layers.map((l) => `${l.actionLabel} ${l.label}${l.thicknessCm ? ` ${l.thicknessCm} cm` : ""}`).join(" · ") : "Tidak ada") : NB}</Row>
        <Row label="Total tinggi lapisan">{plan ? plan.summary?.label : NB}</Row>
      </Stage>
      <Stage n="3" title="Hasil akhir" testid="journey-akhir">
        <Row label="Susunan aktual">{actual ? `${actual.summary?.label}${pva?.available && pva.total?.differenceCm != null ? ` · selisih rencana ${pva.total.differenceCm > 0 ? "+" : ""}${pva.total.differenceCm} cm` : ""}` : NB}</Row>
        <Row label="Fondasi baru (uji QC)">{m.foundationAfter ? `${m.foundationAfter.unloadedHeightCm} → ${m.foundationAfter.loadedHeightCm} cm · turun ${cm(m.foundationAfter.dropCm)} · ${m.foundationAfter.testerWeightKg} kg` : NB}</Row>
        {m.foundationAfter && m.comparisons?.foundation?.text && <p className="m-0 pb-1 text-right text-[12px] text-ink3" data-testid="journey-cmp-foundation" data-comparable={m.comparisons.foundation.comparable ? "1" : "0"}>{m.comparisons.foundation.text}</p>}
        <Row label="Kasur jadi (uji QC)">{m.wholeAfter ? `turun ${cm(m.wholeAfter.wholeDropCm)} · ${m.wholeAfter.testerWeightKg} kg` : NB}</Row>
        {m.wholeAfter && m.comparisons?.whole?.text && <p className="m-0 pb-1 text-right text-[12px] text-ink3" data-testid="journey-cmp-whole" data-comparable={m.comparisons.whole.comparable ? "1" : "0"}>{m.comparisons.whole.text}</p>}
        <Row label="Kesesuaian keluhan awal">{m.wholeAfter ? <Badge variant={verdict === "SESUAI" ? "green" : verdict === "SEBAGIAN" ? "orange" : "neutral"}>{m.wholeAfter.complaintMatchLabel}</Badge> : NB}</Row>
      </Stage>
      <p className="m-0 text-[11.5px] text-ink3" data-testid="journey-separation">{m.separationNote}</p>
    </section>
  );
}
