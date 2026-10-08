import React, { useEffect, useRef, useState } from "react";
import { Camera, ClipboardCheck, Loader2, X } from "lucide-react";
import { api } from "@/api.js";
import { useOnline } from "@/components/StandaloneShell.jsx";
import { compressImage } from "@/utils/compressImage.js";
import { FAIL_VERDICTS, buildInspectionBody, nextInspectionSummary, qcErrorMessage, reworkStageOptions, validateInspectionForm } from "@/features/production/qcHandoff.js";
import { JourneySummary } from "./JourneySummary.jsx";
import { decisionGate } from "./componentNotesModel.js";

// Form PUTUSAN QC di Aplikasi PIC QC (Fase 4 LAYANAN): Lulus atau Gagal → rework, memakai command QC yang SUDAH ada (POST /production-planning/qc/runs/:id/inspect; izin QC_WRITE,
// revisi Run, Idempotency-Key per niat, foto + berat acuan + tahap rework eksplisit). Tidak ada command baru. Waive/override preferensi tetap di Hub QC (kewenangan khusus).
// Lulus hanya bila gerbang putaran ini lengkap (uji fondasi baru bila ada modul fondasi, hasil aktual, uji kasur jadi) — dicek UI dan ditegakkan server (QC_*_REQUIRED).
const FIELD = "block w-full min-h-[44px] rounded-btn border border-line bg-surface px-3 py-2.5 text-[15px] text-ink outline-none focus:border-accent";
const newKey = () => `qc-dec-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`}`;

export function QcDecisionSheet({ item, detail, onClose, onDone }) {
  const online = useOnline();
  const [run, setRun] = useState(null); const [loadError, setLoadError] = useState("");
  const [form, setForm] = useState({ mode: "PASS", photoUrls: [], referenceWeightKg: "", fitVerdict: "PAS", note: "", reworkStageId: "", materials: [] });
  const [busy, setBusy] = useState(false); const [uploading, setUploading] = useState(false); const [error, setError] = useState("");
  const keyRef = useRef(newKey());
  const set = (patch) => { setForm((f) => ({ ...f, ...patch })); keyRef.current = newKey(); setError(""); };
  const load = () => api.getQcRun(item.runId).then((r) => { setRun(r); setLoadError(""); }).catch((e) => setLoadError(qcErrorMessage(e)));
  useEffect(() => { load(); }, [item.runId]);
  const stages = reworkStageOptions(run);
  const gate = decisionGate(detail?.assembly);
  const passBlocked = form.mode === "PASS" && !gate.ok;

  async function pickPhotos(e) {
    const files = Array.from(e.target.files || []); if (!files.length) return;
    setUploading(true);
    try {
      const compressed = await Promise.all(files.map((f) => compressImage(f)));
      const fd = new FormData(); compressed.forEach((f) => fd.append("photos", f));
      const { urls } = await api.uploadUnitPhotos(item.unitId, fd);
      set({ photoUrls: [...form.photoUrls, ...urls] });
    } catch (err) { setError(err.message || "Gagal mengunggah foto"); } finally { setUploading(false); e.target.value = ""; }
  }
  async function submit() {
    if (passBlocked) { setError(gate.message); return; }
    const check = validateInspectionForm(form, { profile: "KASUR" });
    if (!check.valid) { setError(check.errors[0]); return; }
    setBusy(true); setError("");
    try {
      const res = await api.recordQcInspection(item.runId, buildInspectionBody(form, run.revision, { profile: "KASUR" }), keyRef.current);
      onDone(nextInspectionSummary(res), res);
    } catch (e) {
      if (e?.code === "QC_REVISION_CONFLICT") load();
      setError(qcErrorMessage(e));
    } finally { setBusy(false); }
  }
  const mode = form.mode;
  return (
    <div role="dialog" aria-modal="true" aria-label="Putusan QC" data-testid="qc-decision-sheet" className="fixed inset-0 z-[230] flex flex-col bg-base">
      <div className="flex items-center gap-2 border-b border-line bg-surface px-3 py-2" style={{ paddingTop: "calc(0.5rem + env(safe-area-inset-top))" }}>
        <button type="button" onClick={onClose} aria-label="Tutup" className="flex h-11 w-11 items-center justify-center rounded-btn text-ink2 hover:bg-hovertint"><X size={20} aria-hidden /></button>
        <div className="min-w-0 flex-1"><p className="m-0 truncate text-[12px] text-ink3">{item.unitCode}{detail?.assembly?.round ? ` · putaran ${detail.assembly.round}` : ""}</p><p className="m-0 truncate text-[16px] font-bold text-ink">Putusan QC</p></div>
      </div>
      <div className="mx-auto w-full max-w-[720px] flex-1 space-y-4 overflow-y-auto px-3 py-4">
        {loadError && <p role="alert" className="m-0 rounded-btn bg-redbg px-3 py-2 text-[13px] text-red">{loadError}</p>}
        {!run && !loadError && <div className="flex items-center gap-2 text-[13px] text-ink3"><Loader2 size={14} className="animate-spin" aria-hidden /> Memuat…</div>}
        <JourneySummary data={detail} compact />
        <div role="tablist" aria-label="Putusan" className="flex gap-2" data-testid="decision-modes">
          {[["PASS", "Lulus"], ["FAIL", "Gagal → rework"]].map(([k, l]) => (
            <button key={k} role="tab" type="button" aria-selected={mode === k} data-testid={`decision-${k.toLowerCase()}`} onClick={() => set({ mode: k, fitVerdict: k === "FAIL" ? "TERLALU_KERAS" : "PAS" })}
              className={`min-h-[48px] flex-1 rounded-btn px-3 text-[14px] font-bold ${mode === k ? (k === "PASS" ? "bg-green text-white" : "bg-red text-white") : "bg-inset text-ink2"}`}>{l}</button>
          ))}
        </div>
        {mode === "PASS" && !gate.ok && <p role="alert" data-testid="decision-gate-block" className="m-0 rounded-btn bg-orangebg px-3 py-2 text-[13px] text-orange"><b>Lulus belum bisa diputuskan.</b> {gate.message}</p>}
        {mode === "PASS" && gate.ok && <p data-testid="decision-gate-ok" className="m-0 rounded-btn bg-greenbg px-3 py-2 text-[13px] text-green">Gerbang putaran ini lengkap: {gate.parts.join(" · ")}.</p>}
        <label className="block space-y-1 text-[13px] font-semibold text-ink2"><span>Berat acuan (kg) *</span><input data-testid="decision-weight" inputMode="numeric" className={FIELD} placeholder="mis. 75" value={form.referenceWeightKg} onChange={(e) => set({ referenceWeightKg: e.target.value })} /></label>
        {mode === "FAIL" && (
          <label className="block space-y-1 text-[13px] font-semibold text-ink2"><span>Hasil uji berat badan *</span>
            <select data-testid="decision-verdict" className={FIELD} value={form.fitVerdict} onChange={(e) => set({ fitVerdict: e.target.value })}>{FAIL_VERDICTS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}</select></label>
        )}
        <label className="block space-y-1 text-[13px] font-semibold text-ink2"><span>{mode === "FAIL" ? "Alasan / temuan (wajib)" : "Catatan (opsional)"}</span>
          <textarea data-testid="decision-note" rows={3} maxLength={500} className={FIELD} placeholder={mode === "FAIL" ? "Mis. tengah masih agak turun saat dibebani" : "Opsional"} value={form.note} onChange={(e) => set({ note: e.target.value })} /></label>
        {mode === "FAIL" && (
          <label className="block space-y-1 text-[13px] font-semibold text-ink2"><span>Tahap rework * <span className="font-normal text-ink3">(unit wajib melewati gerbang lagi)</span></span>
            <select data-testid="decision-rework-stage" className={FIELD} value={form.reworkStageId} onChange={(e) => set({ reworkStageId: e.target.value })}><option value="">— Pilih tahap —</option>{stages.map((s) => <option key={s.id} value={s.id}>{s.order}. {s.label}</option>)}</select></label>
        )}
        {mode === "FAIL" && <p className="m-0 rounded-btn bg-inset px-3 py-2 text-[12.5px] text-ink2" data-testid="decision-rework-note">Bahan tambahan untuk rework diminta oleh PIC Bahan (aplikasi Bahan) dan diserahkan Gudang; permintaan hanya bisa diajukan sebelum PIC Meja memulai rework. Hasil aktual dan uji kasur jadi putaran berikutnya wajib dicatat ulang.</p>}
        <div className="space-y-2">
          <label className="inline-flex min-h-[48px] cursor-pointer items-center gap-2 rounded-btn border border-line px-3 text-[14px] font-semibold text-ink2">
            {uploading ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Camera size={16} aria-hidden />}{form.photoUrls.length ? `${form.photoUrls.length} foto siap` : "Ambil / pilih foto bukti (wajib)"}
            <input type="file" accept="image/*" capture="environment" multiple hidden data-testid="decision-photos" onChange={pickPhotos} disabled={busy || uploading} />
          </label>
        </div>
      </div>
      <div className="space-y-2 border-t border-line bg-surface px-3 pt-3" style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}>
        <div className="mx-auto w-full max-w-[720px] space-y-2">
          {error && <div role="alert" data-testid="decision-error" className="rounded-btn bg-redbg px-3 py-2 text-[13px] text-red">{error}</div>}
          <button type="button" data-mutates data-testid="decision-submit" disabled={busy || uploading || !online || !run || passBlocked} onClick={submit}
            className={`flex min-h-[56px] w-full items-center justify-center gap-2 rounded-btn text-[16px] font-bold text-white disabled:opacity-50 ${mode === "FAIL" ? "bg-red" : "bg-green"}`}>
            {busy ? <Loader2 size={20} className="animate-spin" aria-hidden /> : <ClipboardCheck size={18} aria-hidden />}{mode === "FAIL" ? "Simpan — Gagal & Buka Rework" : "Simpan — Lulus"}
          </button>
        </div>
      </div>
    </div>
  );
}
