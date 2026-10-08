import React, { useCallback, useEffect, useState } from "react";
import { History, Pencil, Plus } from "lucide-react";
import { api } from "@/api.js";
import { isDemoActive } from "@/features/production/demo/demoGate.js";
import { BeforeAfterSummary } from "./BeforeAfterSummary.jsx";
import { ComponentNoteSheet } from "./ComponentNoteSheet.jsx";
import { NOT_RECORDED, SECTIONS, focusCopy, focusFor, fmtStamp, sectionStatusText } from "./componentNotesModel.js";

// Panel Catatan Komponen — SATU komponen yang sama dipakai Aplikasi Meja, Corner, Dokumentasi, dan Unit 360 (membaca endpoint yang sama; tidak ada input ulang per aplikasi).
// `stepNo` (opsional) menandai seksi yang relevan dengan tahap berjalan; tidak pernah menjadi syarat tahap. Izin tulis diputuskan SERVER (canWrite).
export function ComponentNotesPanel({ unitId, unitCode = null, stepNo = null, showHistory = true, onChanged = null }) {
  const [data, setData] = useState(null); const [error, setError] = useState(""); const [unavailable, setUnavailable] = useState(null); // null | "DEMO" | "OUT_OF_COHORT"
  const [sheet, setSheet] = useState(null); const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    try {
      const d = await api.getComponentNotes(unitId);
      if (d?.readerMode === "OFF") { setUnavailable("OUT_OF_COHORT"); return; }
      setData(d); setError(""); setUnavailable(null);
    } catch (e) {
      // Jujur, bukan diam: Mode Latihan belum punya data komponen (tanpa jaringan, tanpa formulir/unggah) dan unit di luar jalur V2 tidak punya catatan komponen.
      if (e?.code === "DEMO_MISS" || isDemoActive()) { setUnavailable("DEMO"); return; }
      if (e?.status === 404) { setUnavailable("OUT_OF_COHORT"); return; }
      setError("Catatan komponen belum bisa dimuat.");
    }
  }, [unitId]);
  useEffect(() => { setData(null); setUnavailable(null); load(); }, [load]);
  useEffect(() => { if (!notice) return undefined; const t = setTimeout(() => setNotice(""), 4000); return () => clearTimeout(t); }, [notice]);
  if (unavailable) {
    return (
      <p role="status" data-testid="component-unavailable" data-reason={unavailable} className="m-0 rounded-btn bg-inset px-3 py-2.5 text-[13px] text-ink3">
        {unavailable === "DEMO" ? "Mode Latihan: catatan komponen belum punya data latihan — formulir dan unggah foto dinonaktifkan." : "Catatan komponen belum tersedia untuk unit ini (unit ini belum memakai alur kerja baru Production)."}
      </p>
    );
  }
  if (error && !data) return <p role="alert" className="m-0 text-[13px] text-ink3" data-testid="component-load-error">{error} <button type="button" onClick={load} className="font-bold underline">Coba lagi</button></p>;
  if (!data) return <div className="h-24 animate-pulse rounded-card bg-inset" data-testid="component-loading" />;

  const canWrite = !!data.canWrite;
  const focus = focusFor(stepNo).filter((k) => !data.sections[k]);
  const copy = focusCopy(stepNo);
  const beforeCount = data.sections.LAYERS_BEFORE?.data?.layers?.length || 0;
  const done = async () => { setSheet(null); setNotice("Catatan komponen tersimpan."); await load(); onChanged?.(); };

  return (
    <div className="space-y-3" data-testid="component-panel" data-unit-id={unitId}>
      {notice && <p role="status" data-testid="component-notice" className="m-0 rounded-btn bg-greenbg px-3 py-2 text-[13px] font-semibold text-green">{notice}</p>}
      {canWrite && copy && focus.length > 0 && (
        <div className="rounded-btn border border-orange/40 bg-orangebg px-3 py-3" data-testid="component-focus">
          <p className="m-0 text-[14px] font-bold text-orange">{copy.title}</p>
          <p className="m-0 mt-0.5 text-[12.5px] text-orange">{copy.text} Tidak wajib untuk melanjutkan tahap.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {focus.map((k) => <button key={k} type="button" data-testid={`focus-open-${k}`} onClick={() => setSheet(k)} className="min-h-[44px] rounded-btn bg-orange px-3 text-[13.5px] font-bold text-white">{SECTIONS.find((s) => s.key === k).label}</button>)}
          </div>
        </div>
      )}
      <ul className="m-0 list-none space-y-2 p-0">
        {SECTIONS.map((s) => {
          const e = data.sections[s.key];
          return (
            <li key={s.key} data-testid="component-section" data-section={s.key} data-recorded={e ? "1" : "0"} className="rounded-btn bg-inset p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="m-0 text-[13.5px] font-bold text-ink">{s.label}</p>
                  <p className="m-0 text-[12px] text-ink3" data-testid="section-status">{e ? `${sectionStatusText(e)} · ${fmtStamp(e.at)}` : NOT_RECORDED}</p>
                </div>
                {canWrite && <button type="button" data-testid={`open-section-${s.key}`} data-mutates onClick={() => setSheet(s.key)} className="flex min-h-[44px] shrink-0 items-center gap-1 rounded-btn bg-surface px-3 text-[13px] font-semibold text-accent">{e ? <><Pencil size={14} aria-hidden /> Koreksi</> : <><Plus size={14} aria-hidden /> Isi</>}</button>}
              </div>
              {e?.media?.length > 0 && (
                <ul className="m-0 mt-2 grid list-none grid-cols-4 gap-1.5 p-0" data-testid="section-photos">
                  {e.media.map((m) => <li key={m.url}><img src={m.previewUrl} alt={m.caption || s.label} loading="lazy" className="aspect-square w-full rounded-btn bg-surface object-cover" /></li>)}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      <BeforeAfterSummary comparison={data.comparison} />
      {showHistory && data.history.length > 1 && (
        <details className="text-[12px]" data-testid="component-history">
          <summary className="flex min-h-[32px] cursor-pointer items-center gap-1.5 text-ink3"><History size={13} aria-hidden /> Riwayat catatan ({data.history.length})</summary>
          <ul className="m-0 mt-1 list-none space-y-1.5 p-0">
            {[...data.history].reverse().map((h) => (
              <li key={`${h.section}-${h.version}`} data-testid="history-row" data-superseded={h.superseded ? "1" : "0"} className="rounded-btn bg-inset px-2.5 py-2 text-ink2">
                <p className="m-0 break-words">{h.sectionLabel} · versi {h.version} · {h.actor?.name || "—"} ({fmtStamp(h.at)}){h.superseded ? " — digantikan" : ""}</p>
                {h.reason && <p className="m-0 break-words text-ink3">Alasan: {h.reason}</p>}
              </li>
            ))}
          </ul>
        </details>
      )}
      {sheet && <ComponentNoteSheet unitId={unitId} unitCode={unitCode || data.unitCode} section={sheet} entry={data.sections[sheet]} suggestions={data.suggestions} beforeCount={beforeCount}
        onClose={() => setSheet(null)} onSaved={done} onReload={async () => { setSheet(null); await load(); }} />}
    </div>
  );
}
