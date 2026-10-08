import React from "react";
import { Badge } from "@/components/ui/badge.jsx";
import { NOT_RECORDED } from "./componentNotesModel.js";

// Perjalanan unit (Fase 4 LAYANAN): KONDISI AWAL → RACIKAN → HASIL AKHIR dalam satu ringkasan. SATU sumber (Catatan Komponen; `measurements` + `comparison` + `assembly` dari endpoint yang sama)
// dipakai di Meja, Aplikasi PIC QC, Dokumentasi, Unit 360, dan laporan. Data kosong = "Belum dicatat". Penurunan kasur utuh dan fondasi TIDAK dijumlahkan; tanpa label "amblas" otomatis.
// PUTARAN: setelah putusan QC gagal (rework) hasil putaran lama TIDAK dianggap hasil putaran terbaru — baris hasil akhir menampilkan "Belum dicatat untuk putaran ini" dan nilai lama
// diberi label "Putaran sebelumnya"; riwayat putusan gagal tetap terlihat. Selisih uji hanya tampil bila PIC QC mengonfirmasi metode sebanding (teks dari server).
const NB = <span className="italic text-ink3" data-testid="not-recorded">{NOT_RECORDED}</span>;
const Row = ({ label, children, testid }) => (<div className="flex items-start justify-between gap-3 border-t border-line py-1.5 text-[13px] first:border-t-0" data-testid={testid}><span className="shrink-0 text-ink3">{label}</span><span className="min-w-0 text-right font-semibold text-ink [overflow-wrap:anywhere]">{children}</span></div>);
const Stage = ({ n, title, children, testid }) => (
  <section className="rounded-btn bg-inset p-3" data-testid={testid}>
    <p className="m-0 mb-1 flex items-center gap-2 text-[13.5px] font-bold text-ink"><span aria-hidden className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-[12px] text-white">{n}</span>{title}</p>
    {children}
  </section>
);
const cm = (v) => (v == null ? null : `${v} cm`);
const STALE = (what) => <span data-testid="stale-note" className="italic text-orange">Belum dicatat untuk putaran ini{what ? ` — ${what}` : ""}</span>;

export function JourneySummary({ data, compact = false }) {
  if (!data) return null;
  const m = data.measurements || {}; const c = data.comparison || {}; const s = data.sections || {};
  const asm = data.assembly?.applicable ? data.assembly : null;
  const anything = m.whole || m.foundation || m.layers || c.plan || c.actual || m.wholeAfter || m.foundationAfter;
  if (!anything) return null;
  const plan = c.plan; const actual = c.actual; const pva = c.planVsActual;
  const fdn = (v) => (v?.foundation ? `${v.foundation.actionLabel} — ${v.foundation.label}` : null);
  const verdict = m.wholeAfter?.complaintMatch ?? s.WHOLE_TEST_AFTER?.data?.complaintMatch;
  // keabsahan per bagian pada putaran ini (tanpa assembly = tidak ada konsep putaran: semua dianggap berlaku)
  const okFoundation = !asm || !!asm.current?.foundationTest?.ok; const okAfter = !asm || !!asm.current?.after?.ok; const okWhole = !asm || !!asm.current?.wholeTest?.ok;
  const showFoundationTest = !asm || asm.hasFoundation;
  const prev = (txt) => (txt ? <span className="block text-[12px] font-normal text-ink3" data-testid="previous-round-value">Putaran sebelumnya: {txt}</span> : null);
  const fAfterTxt = m.foundationAfter ? `${m.foundationAfter.unloadedHeightCm} → ${m.foundationAfter.loadedHeightCm} cm · turun ${cm(m.foundationAfter.dropCm)} · ${m.foundationAfter.testerWeightKg} kg` : null;
  const wAfterTxt = m.wholeAfter ? `turun ${cm(m.wholeAfter.wholeDropCm)} · ${m.wholeAfter.testerWeightKg} kg` : null;
  const aAfterTxt = actual ? `${actual.summary?.label}${pva?.available && pva.total?.differenceCm != null ? ` · selisih rencana ${pva.total.differenceCm > 0 ? "+" : ""}${pva.total.differenceCm} cm` : ""}` : null;
  return (
    <section className="space-y-2" aria-label="Kondisi awal, racikan, dan hasil akhir" data-testid="journey-summary" data-round={asm?.round ?? ""}>
      <p className="m-0 flex flex-wrap items-center gap-2 text-[13px] font-bold text-ink">Kondisi awal → racikan → hasil akhir{asm && <Badge variant={asm.round > 1 ? "orange" : "neutral"} data-testid="round-badge">Putaran {asm.round}</Badge>}</p>
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
        {asm && <Row label="Jenis racikan">{asm.hasFoundation && asm.hasLayers ? "Fondasi + lapisan" : asm.hasFoundation ? "Hanya fondasi" : "Hanya lapisan"}</Row>}
      </Stage>
      <Stage n="3" title={asm ? `Hasil akhir — putaran ${asm.round}` : "Hasil akhir"} testid="journey-akhir">
        <Row label="Susunan aktual">{actual ? (okAfter ? aAfterTxt : <>{STALE("Meja perlu memperbarui")}{prev(aAfterTxt)}</>) : NB}</Row>
        {showFoundationTest && (
          <>
            <Row label="Fondasi baru (uji QC)">{m.foundationAfter ? (okFoundation ? fAfterTxt : <>{STALE("uji ulang oleh PIC QC")}{prev(fAfterTxt)}</>) : NB}</Row>
            {m.foundationAfter && okFoundation && m.comparisons?.foundation?.text && <p className="m-0 pb-1 text-right text-[12px] text-ink3" data-testid="journey-cmp-foundation" data-comparable={m.comparisons.foundation.comparable ? "1" : "0"}>{m.comparisons.foundation.text}</p>}
          </>
        )}
        {!showFoundationTest && <Row label="Fondasi baru (uji QC)"><span className="font-normal text-ink3" data-testid="no-foundation-module">Tidak ada modul fondasi pada rute ini</span></Row>}
        <Row label="Kasur jadi (uji QC)">{m.wholeAfter ? (okWhole ? wAfterTxt : <>{STALE("uji ulang oleh PIC QC")}{prev(wAfterTxt)}</>) : NB}</Row>
        {m.wholeAfter && okWhole && m.comparisons?.whole?.text && <p className="m-0 pb-1 text-right text-[12px] text-ink3" data-testid="journey-cmp-whole" data-comparable={m.comparisons.whole.comparable ? "1" : "0"}>{m.comparisons.whole.text}</p>}
        <Row label="Kesesuaian keluhan awal">{m.wholeAfter ? (okWhole ? <Badge variant={verdict === "SESUAI" ? "green" : verdict === "SEBAGIAN" ? "orange" : "neutral"}>{m.wholeAfter.complaintMatchLabel}</Badge> : STALE()) : NB}</Row>
      </Stage>
      {asm?.rounds?.length > 0 && (
        <Stage n="↺" title="Riwayat putaran (putusan QC gagal)" testid="journey-rounds">
          <ul className="m-0 list-none space-y-1 p-0">
            {asm.rounds.map((r) => (
              <li key={r.inspectionId} data-testid="round-row" className="text-[12.5px] text-ink2">
                <b>Putaran {r.round}</b> — QC gagal{r.verdict ? ` (${r.verdict === "TERLALU_EMPUK" ? "terlalu empuk" : "terlalu keras"})` : ""}{r.note ? `: “${r.note}”` : ""}{r.disposition ? <span className="text-ink3"> · {String(r.disposition).replace("REWORK:", "rework → ")}</span> : null}
              </li>
            ))}
          </ul>
        </Stage>
      )}
      <p className="m-0 text-[11.5px] text-ink3" data-testid="journey-separation">{m.separationNote}</p>
    </section>
  );
}
