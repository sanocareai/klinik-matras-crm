import React, { useEffect, useRef, useState } from "react";
import { Loader2, WifiOff, X } from "lucide-react";
import { api } from "@/api.js";
import { useOnline } from "@/components/StandaloneShell.jsx";
import { friendlyError } from "@/features/production/experience.js";
import {
  DELAY_ACTION_LABEL, DELAY_QUESTION, DELAY_REASON_OPTIONS, FINISH_ACTION_LABEL, SKIP_ACTION_LABEL, SKIP_REASON_LABEL, delayFormValid,
} from "@/features/production/productionLabels.js";
import { submitState } from "./workerAppModel.js";

// Flow adaptasi (slice 2) — lembar layar-penuh Aplikasi Meja/Corner: Lewati Tahap (konfirmasi), Selesaikan Produksi (pratinjau + konfirmasi eksplisit), Tunda Pekerjaan (4 alasan).
// Semua aksi lewat command server (Idempotency-Key per niat, expectedRevision dari kartu/pratinjau). Tidak ada status berhasil lokal; offline menonaktifkan kirim.
const FIELD = "block w-full rounded-btn border border-line bg-surface px-3 py-3 text-[15px] text-ink outline-none focus:border-accent";
const newKey = (tag) => `${tag}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`}`;

function Sheet({ title, subtitle, onClose, children, footer, testid }) {
  return (
    <div role="dialog" aria-modal="true" aria-label={title} data-testid={testid} className="fixed inset-0 z-50 flex flex-col bg-base">
      <div className="flex items-center gap-2 border-b border-line bg-surface px-3 py-2" style={{ paddingTop: "calc(0.5rem + env(safe-area-inset-top))" }}>
        <button type="button" onClick={onClose} aria-label="Tutup" className="flex h-11 w-11 items-center justify-center rounded-btn text-ink2 hover:bg-hovertint"><X size={20} aria-hidden /></button>
        <div className="min-w-0 flex-1">{subtitle && <p className="m-0 truncate text-[12px] text-ink3">{subtitle}</p>}<p className="m-0 truncate text-[16px] font-bold text-ink">{title}</p></div>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-4">{children}</div>
      <div className="space-y-2 border-t border-line bg-surface px-3 pt-3" style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}>{footer}</div>
    </div>
  );
}
const OfflineNote = () => <p role="status" className="m-0 flex items-start gap-2 rounded-btn bg-orangebg px-3 py-2 text-[12.5px] font-semibold text-orange"><WifiOff size={15} className="mt-px shrink-0" aria-hidden /> {submitState({ online: false, busy: false }).reason}</p>;

/** Lewati Tahap: konfirmasi eksplisit; dicatat DILEWATI (bukan dikerjakan) oleh pengguna ini, alasan "Adaptasi sistem", tanpa foto/hasil uji. */
export function SkipSheet({ card, next, stageLabel, onClose, onDone }) {
  const online = useOnline(); const keyRef = useRef(newKey("s2-skip"));
  const [note, setNote] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit() {
    setBusy(true); setError("");
    try { await api.skipProductionV2Step(card.runId, next.stepNo, { expectedRevision: card.revision, workCenterId: card.workCenterId, note: note.trim() || undefined }, keyRef.current); onDone(); }
    catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  }
  const gate = submitState({ online, busy });
  return (
    <Sheet testid="skip-sheet" title={`${SKIP_ACTION_LABEL}: ${stageLabel || "Tahap"}`} subtitle={card.unit.unitCode} onClose={onClose}
      footer={<>{!online && <OfflineNote />}<button type="button" data-mutates data-testid="skip-confirm" disabled={gate.disabled} onClick={submit} className="flex min-h-[56px] w-full items-center justify-center gap-2 rounded-btn bg-accent text-[16px] font-bold text-white disabled:opacity-50">{busy ? <><Loader2 size={20} className="animate-spin" aria-hidden /> Mencatat…</> : "Catat Dilewati"}</button></>}>
      <p className="m-0 rounded-btn bg-orangebg px-3 py-3 text-[13.5px] text-orange" data-testid="skip-explain">Tahap ini akan dicatat <b>DILEWATI</b>, bukan dikerjakan. Alasan: <b>{SKIP_REASON_LABEL}</b>. Tidak ada foto atau hasil uji yang dibuat, dan progres membedakan tahap dilewati dari yang dikerjakan.</p>
      <textarea aria-label="Catatan (opsional)" rows={3} className={FIELD} placeholder="Catatan (opsional)" value={note} onChange={(e) => setNote(e.target.value)} />
      {error && <div role="alert" className="rounded-btn bg-redbg px-3 py-3 text-[13.5px] text-red">{error}</div>}
    </Sheet>
  );
}

/** Selesaikan Produksi: pratinjau tahap tersisa (dari server, baca-saja) + konfirmasi eksplisit sebelum dicatat DILEWATI. Retur sisa bahan tetap wajib (dijelaskan, tidak dilewati diam-diam). */
export function FinishSheet({ card, onClose, onDone }) {
  const online = useOnline(); const keyRef = useRef(newKey("s2-finish"));
  const [prev, setPrev] = useState(null); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const [agree, setAgree] = useState(false); const [wait, setWait] = useState(null);
  useEffect(() => { let alive = true; api.getProductionV2FinishPreview(card.runId).then((p) => { if (alive) setPrev(p); }).catch((e) => { if (alive) setError(friendlyError(e)); }); return () => { alive = false; }; }, [card.runId]);
  async function submit() {
    setBusy(true); setError("");
    try {
      const res = await api.finishProductionV2Run(card.runId, { expectedRevision: prev.revision, workCenterId: card.workCenterId, confirm: true }, keyRef.current);
      if (res.completed === false) { setWait(res); keyRef.current = newKey("s2-finish"); setPrev(await api.getProductionV2FinishPreview(card.runId)); }
      else onDone(res);
    } catch (e) { setError(friendlyError(e)); keyRef.current = newKey("s2-finish"); } finally { setBusy(false); }
  }
  const gate = submitState({ online, busy });
  const can = prev?.canFinish && agree && !gate.disabled;
  return (
    <Sheet testid="finish-sheet" title={FINISH_ACTION_LABEL} subtitle={card.unit.unitCode} onClose={onClose}
      footer={<>{!online && <OfflineNote />}<button type="button" data-mutates data-testid="finish-confirm" disabled={!can} onClick={submit} className="flex min-h-[56px] w-full items-center justify-center gap-2 rounded-btn bg-accent text-[16px] font-bold text-white disabled:opacity-50">{busy ? <><Loader2 size={20} className="animate-spin" aria-hidden /> Menyelesaikan…</> : FINISH_ACTION_LABEL}</button></>}>
      {!prev && !error && <div className="h-24 animate-pulse rounded-card bg-inset" />}
      {prev && (
        <>
          <p className="m-0 rounded-btn bg-orangebg px-3 py-3 text-[13.5px] text-orange" data-testid="finish-statement">{prev.statement}</p>
          <dl className="m-0 grid grid-cols-3 gap-2 text-center text-[12.5px]" data-testid="finish-progress">
            <div className="rounded-btn bg-inset px-2 py-2"><dt className="text-ink3">Dikerjakan</dt><dd className="m-0 text-[18px] font-bold text-ink">{prev.progress.worked}</dd></div>
            <div className="rounded-btn bg-inset px-2 py-2"><dt className="text-ink3">Dilewati</dt><dd className="m-0 text-[18px] font-bold text-ink">{prev.progress.skipped}</dd></div>
            <div className="rounded-btn bg-inset px-2 py-2"><dt className="text-ink3">Akan dilewati</dt><dd className="m-0 text-[18px] font-bold text-orange">{prev.progress.remaining}</dd></div>
          </dl>
          {prev.remainingStages.length > 0 && (
            <div data-testid="finish-remaining"><p className="m-0 mb-1 text-[13px] font-bold text-ink">Tahap tersisa yang akan dicatat dilewati</p>
              <ul className="m-0 list-none space-y-1 p-0">{prev.remainingStages.map((s) => <li key={s.id} className="rounded-btn bg-inset px-3 py-2 text-[13.5px] text-ink2">{s.label}{s.isQcGate ? " — QC dicatat tidak dilakukan (bukan lulus)" : ""}</li>)}</ul></div>
          )}
          {prev.expectedReturns.length > 0 && (
            <div data-testid="finish-returns" className="rounded-btn bg-redbg px-3 py-3 text-[13px] text-red"><p className="m-0 font-bold">Sisa bahan wajib dikembalikan ke Gudang</p>
              <ul className="m-0 mt-1 list-disc pl-5">{prev.expectedReturns.map((r) => <li key={r.code || r.name}>{r.name || r.code} — {r.qty} {r.unit || ""}</li>)}</ul>
              <p className="m-0 mt-1">Produksi baru bisa diselesaikan setelah Gudang menerima sisa ini.</p></div>
          )}
          {prev.blockers.length > 0 && <ul data-testid="finish-blockers" className="m-0 list-none space-y-1 p-0">{prev.blockers.map((b) => <li key={b.code} className="rounded-btn bg-redbg px-3 py-2 text-[13px] text-red">{b.text}</li>)}</ul>}
          <label className="flex items-start gap-2 rounded-btn bg-inset px-3 py-3 text-[13.5px] text-ink"><input data-testid="finish-agree" type="checkbox" className="mt-1" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> Saya mengerti: tahap yang belum dikerjakan dicatat DILEWATI dan QC dicatat tidak dilakukan.</label>
        </>
      )}
      {wait && <p role="status" data-testid="finish-waiting" className="m-0 rounded-btn bg-orangebg px-3 py-3 text-[13.5px] text-orange">{wait.message}</p>}
      {error && <div role="alert" className="rounded-btn bg-redbg px-3 py-3 text-[13.5px] text-red">{error}</div>}
    </Sheet>
  );
}

/** Tunda Pekerjaan (pekerjaan di papan): 4 alasan. "Menunggu bahan" membuka daftar bahan (laporan ke Gudang); lainnya menjeda sah dengan alasan tersimpan. "Lainnya" wajib keterangan. */
export function DelaySheet({ card, onClose, onPickMaterial, onDone }) {
  const online = useOnline(); const keyRef = useRef(newKey("s2-delay"));
  const [key, setKey] = useState("ARAHAN"); const [note, setNote] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit() {
    if (key === "BAHAN") { onPickMaterial(); return; }
    setBusy(true); setError("");
    try { await api.delayProductionV2Run(card.runId, { expectedRevision: card.revision, workCenterId: card.workCenterId, reason: key, note: note.trim() || undefined }, keyRef.current); onDone(); }
    catch (e) { setError(friendlyError(e)); keyRef.current = newKey("s2-delay"); } finally { setBusy(false); }
  }
  const gate = submitState({ online, busy });
  const valid = delayFormValid({ key, note });
  return (
    <Sheet testid="delay-sheet" title={DELAY_ACTION_LABEL} subtitle={card.unit.unitCode} onClose={onClose}
      footer={<>{!online && <OfflineNote />}<button type="button" data-mutates data-testid="delay-confirm" disabled={gate.disabled || !valid} onClick={submit} className="flex min-h-[56px] w-full items-center justify-center rounded-[18px] bg-red text-[17px] font-extrabold text-white disabled:opacity-50">{busy ? "Mengirim…" : key === "BAHAN" ? "Pilih bahan yang kurang" : DELAY_ACTION_LABEL}</button></>}>
      <label className="block text-[13px] font-semibold text-ink2">{DELAY_QUESTION} *
        <select data-testid="delay-reason" className={`${FIELD} mt-1`} value={key} onChange={(e) => setKey(e.target.value)}>{DELAY_REASON_OPTIONS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select></label>
      {key !== "BAHAN" && <textarea data-testid="delay-note" rows={3} className={FIELD} placeholder={key === "LAINNYA" ? "Jelaskan alasannya *" : "Keterangan (opsional)"} value={note} onChange={(e) => setNote(e.target.value)} />}
      {key === "BAHAN" && <p className="m-0 rounded-btn bg-orangebg px-3 py-3 text-[13.5px] text-orange">Pekerjaan tampil “Tertunda — menunggu bahan” dan Gudang langsung melihat daftar bahan. Hanya Gudang yang bisa menutupnya.</p>}
      {error && <div role="alert" className="rounded-btn bg-redbg px-3 py-3 text-[13.5px] text-red">{error}</div>}
    </Sheet>
  );
}
