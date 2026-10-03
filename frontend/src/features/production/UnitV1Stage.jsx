import React, { useEffect, useState } from "react";
import { AlertTriangle, Camera, CheckCircle2, Loader2, PauseCircle, PlayCircle, XCircle } from "lucide-react";
import { api } from "@/api.js";
import { compressImage } from "@/utils/compressImage.js";
import { Button } from "@/components/ui/button.jsx";
import { BLOCK_REASON_REAL, FIT_VERDICT_REAL, PAUSE_REASON_REAL, PREFERENCE_OVERRIDE_REAL } from "@/features/bengkel/unitStatus.js";
import { canAssignV1, canQcV1, canStageV1, completeFormValid, failFormValid, needsPhotoOf, pauseFormValid, qcFormValid, stageStateOf } from "./unitV1ActionsModel.js";

// P12B.6 — pekerjaan harian V1 untuk unit NON-V2 di drawer Unit 360: mulai/selesaikan tahap (+foto & catatan = dokumentasi V1), jeda/lanjut, terhambat, putusan QC, penugasan.
// Memakai engine V1 apa adanya (endpoint & izin yang sudah ada; engine sendiri menolak 409 untuk unit yang dikelola V2). TIDAK ada "lewati tahap" dan "ubah rute"
// (sengaja dihentikan — lihat V1_ACTION_MATRIX). Hanya dirender untuk unit di luar cohort; unit cohort memakai Aplikasi Meja/Corner/QC V2.
const INPUT = "w-full rounded-btn border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent";
const Msg = ({ kind, children, testid }) => (children ? <p role={kind === "error" ? "alert" : "status"} data-testid={testid} className={`m-0 rounded-btn px-3 py-2 text-[12px] ${kind === "error" ? "bg-redbg text-red" : "bg-greenbg text-green"}`}>{children}</p> : null);

function PhotoPicker({ unitId, photos, setPhotos, disabled, onError }) {
  const [busy, setBusy] = useState(false);
  async function pick(e) {
    const files = Array.from(e.target.files || []); if (!files.length) return;
    setBusy(true);
    try {
      const fd = new FormData(); (await Promise.all(files.map((f) => compressImage(f)))).forEach((f) => fd.append("photos", f));
      const { urls } = await api.uploadUnitPhotos(unitId, fd); setPhotos((p) => [...p, ...urls]);
    } catch (err) { onError(err.message || "Foto gagal diunggah"); } finally { setBusy(false); e.target.value = ""; }
  }
  return (
    <div className="space-y-1.5">
      <label className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border text-[12px] font-medium text-ink2 hover:border-accent hover:text-accent">
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}{photos.length ? `${photos.length} foto siap` : "Ambil / pilih foto"}
        <input data-testid="v1-photo-input" type="file" accept="image/*" capture="environment" multiple hidden onChange={pick} disabled={busy || disabled} />
      </label>
      {photos.length > 0 && <div className="flex flex-wrap gap-1.5">{photos.map((u) => <img key={u} src={u} alt="" className="h-12 w-12 rounded object-cover" />)}</div>}
    </div>
  );
}

export default function UnitV1Stage({ data, roles, onData, onChanged }) {
  const unit = data.unit; const st = stageStateOf(data); const cur = st.current;
  const canStage = canStageV1(roles); const canQc = canQcV1(roles); const canAssign = canAssignV1(roles);
  const [mode, setMode] = useState(null); // complete | fail | pause
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ kind: "", text: "" });
  const [note, setNote] = useState(""); const [photos, setPhotos] = useState([]);
  const [reason, setReason] = useState("MATERIAL_SHORTAGE"); const [pauseReason, setPauseReason] = useState("BREAK");
  const [qc, setQc] = useState({ verdict: "", weight: "", override: "", education: false }) // verdict WAJIB dipilih eksplisit (tanpa bawaan) — putusan QC tidak boleh lolos karena nilai awal;
  const [assign, setAssign] = useState({ open: false, wc: "", op: "", refs: null });
  useEffect(() => { setMode(null); setNote(""); setPhotos([]); }, [unit.id, unit.currentStageId, cur?.status]);

  async function run(fn, ok) {
    setBusy(true); setMsg({ kind: "", text: "" });
    try { await fn(); onData(await api.getUnitTimeline(unit.id)); onChanged?.(); setMode(null); setNote(""); setPhotos([]); setMsg({ kind: "ok", text: ok }); }
    catch (e) { setMsg({ kind: "error", text: e.message || "Gagal" }); try { onData(await api.getUnitTimeline(unit.id)); } catch { /* biarkan */ } } finally { setBusy(false); }
  }
  async function openAssign() {
    setAssign((a) => ({ ...a, open: true }));
    if (!assign.refs) { try { const [w, o] = await Promise.all([api.getWorkCenters(), api.getProductionOperators()]); setAssign((a) => ({ ...a, refs: { wcs: w.workCenters || [], ops: (o.operators || []).filter((x) => x.active) } })); } catch (e) { setMsg({ kind: "error", text: e.message }); } }
  }
  const stage = cur?.stage; const photoNeeded = needsPhotoOf(st);
  const label = stage?.labelId;

  let body;
  if (!canStage && !canQc) body = <p className="m-0 text-[12px] text-ink3">Hanya tim produksi/QC yang dapat menjalankan tahap.</p>;
  else if (st.kind === "NEEDS_SERVICE") body = <p className="m-0 text-[12px] text-ink3">Tetapkan layanan teknis dulu sebelum tahap dapat dimulai.</p>;
  else if (st.kind === "ALL_DONE") body = <p className="m-0 text-[12.5px] text-green">Seluruh tahap selesai.</p>;
  else if (!canStage) body = <p className="m-0 text-[12px] text-ink3">Tahap saat ini: <b>{label || st.first?.labelId}</b>. Hanya tim produksi/QC yang dapat menjalankannya.</p>;
  else if (st.kind === "NOT_STARTED") body = <Button size="sm" className="w-full" data-testid="v1-stage-start" disabled={busy} onClick={() => run(() => api.startUnitStage(unit.id), "Tahap dimulai.")}>{busy ? <Loader2 size={14} className="animate-spin" /> : <PlayCircle size={14} />} Mulai {st.first?.labelId}</Button>;
  else if (st.kind === "READY") body = <div className="space-y-2"><p className="m-0 text-[12.5px] text-ink2">Tahap berikutnya: <b>{label}</b></p><Button size="sm" className="w-full" data-testid="v1-stage-start" disabled={busy} onClick={() => run(() => api.startUnitStage(unit.id), "Tahap dimulai.")}>{busy ? <Loader2 size={14} className="animate-spin" /> : <PlayCircle size={14} />} Mulai tahap</Button></div>;
  else if (st.kind === "BLOCKED") body = <div className="space-y-2"><p className="m-0 rounded-btn bg-redbg px-2.5 py-2 text-[12px] text-red">Tahap "{label}" terhambat. Selesaikan blokir di bagian Blokir Produksi, lalu mulai lagi.</p><Button size="sm" className="w-full" data-testid="v1-stage-start" disabled={busy} onClick={() => run(() => api.startUnitStage(unit.id), "Tahap dimulai lagi.")}>{busy ? <Loader2 size={14} className="animate-spin" /> : <PlayCircle size={14} />} Mulai lagi</Button></div>;
  else if (st.kind === "PAUSED") body = <div className="space-y-2"><p className="m-0 rounded-btn bg-orangebg px-2.5 py-2 text-[12px] text-orange">Tahap "{label}" sedang dijeda.</p><Button size="sm" className="w-full" data-testid="v1-stage-resume" disabled={busy} onClick={() => run(() => api.resumeUnitStage(unit.id, stage.id), "Tahap dilanjutkan.")}>{busy ? <Loader2 size={14} className="animate-spin" /> : <PlayCircle size={14} />} Lanjutkan</Button></div>;
  else if (st.kind === "IN_PROGRESS_QC") {
    body = !canQc ? <p className="m-0 text-[12.5px] text-ink3" data-testid="v1-qc-denied">Tahap gerbang QC <b>{label}</b> berjalan — putusan hanya oleh QC.</p> : (
      <div className="space-y-2" data-testid="v1-qc-form">
        <p className="m-0 text-[12.5px] text-ink2">Uji Berat Badan: <b>{label}</b></p>
        <label className="block text-[11.5px] font-semibold text-ink2">Verdict *<select data-testid="v1-qc-verdict" className={`${INPUT} mt-1`} value={qc.verdict} onChange={(e) => setQc({ ...qc, verdict: e.target.value })}><option value="">— pilih verdict —</option>{Object.entries(FIT_VERDICT_REAL).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
        <label className="block text-[11.5px] font-semibold text-ink2">Berat acuan (kg) *<input data-testid="v1-qc-weight" type="number" min="1" className={`${INPUT} mt-1`} value={qc.weight} onChange={(e) => setQc({ ...qc, weight: e.target.value })} /></label>
        <label className="block text-[11.5px] font-semibold text-ink2">Override preferensi customer<select className={`${INPUT} mt-1`} value={qc.override} onChange={(e) => setQc({ ...qc, override: e.target.value })}><option value="">Tidak ada — ikuti rekomendasi</option>{Object.entries(PREFERENCE_OVERRIDE_REAL).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
        {qc.override && <label className="flex items-center gap-1.5 text-[11.5px] text-ink2"><input type="checkbox" checked={qc.education} onChange={(e) => setQc({ ...qc, education: e.target.checked })} /> Edukasi risiko sudah diberikan ke customer (wajib)</label>}
        <PhotoPicker unitId={unit.id} photos={photos} setPhotos={setPhotos} onError={(t) => setMsg({ kind: "error", text: t })} />
        {photoNeeded && photos.length === 0 && <p className="m-0 text-[11px] text-orange">Tahap ini wajib foto</p>}
        <textarea rows={2} className={INPUT} placeholder="Catatan (opsional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <Button size="sm" className="w-full" data-testid="v1-qc-save" disabled={busy || !qcFormValid({ verdict: qc.verdict, referenceWeightKg: qc.weight, override: qc.override, educationGiven: qc.education, needsPhoto: photoNeeded, photos })}
          onClick={() => run(() => api.recordQcFitTest(unit.id, stage.id, { verdict: qc.verdict, referenceWeightKg: Number(qc.weight), customerPreferenceOverride: qc.override || null, educationGiven: qc.education, note, photoUrls: photos }), "Hasil QC tersimpan.")}>{busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Simpan hasil QC</Button>
      </div>
    );
  } else if (mode === "complete") body = (
    <div className="space-y-2" data-testid="v1-complete-form">
      <PhotoPicker unitId={unit.id} photos={photos} setPhotos={setPhotos} onError={(t) => setMsg({ kind: "error", text: t })} />
      <textarea rows={2} className={INPUT} placeholder="Catatan (opsional)" value={note} onChange={(e) => setNote(e.target.value)} />
      {photoNeeded && photos.length === 0 && <p className="m-0 text-[11px] text-orange">Tahap ini wajib foto</p>}
      <div className="flex gap-2"><Button size="sm" variant="ghost" className="flex-1" onClick={() => setMode(null)}>Batal</Button><Button size="sm" className="flex-1" data-testid="v1-complete-save" disabled={busy || !completeFormValid({ needsPhoto: photoNeeded, photos })} onClick={() => run(() => api.completeUnitStage(unit.id, stage.id, { photoUrls: photos, note }), "Tahap selesai.")}>{busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Simpan</Button></div>
    </div>
  ); else if (mode === "fail") body = (
    <div className="space-y-2" data-testid="v1-fail-form">
      <label className="block text-[11.5px] font-semibold text-ink2">Alasan hambatan *<select data-testid="v1-fail-reason" className={`${INPUT} mt-1`} value={reason} onChange={(e) => setReason(e.target.value)}>{Object.entries(BLOCK_REASON_REAL).map(([k, r]) => <option key={k} value={k}>{r.label}</option>)}</select></label>
      <textarea data-testid="v1-fail-note" rows={2} className={INPUT} placeholder={reason === "OTHER" ? "Jelaskan alasannya *" : "Catatan (opsional)"} value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="flex gap-2"><Button size="sm" variant="ghost" className="flex-1" onClick={() => setMode(null)}>Batal</Button><Button size="sm" variant="destructive" className="flex-1" data-testid="v1-fail-save" disabled={busy || !failFormValid({ reason, note })} onClick={() => run(() => api.failUnitStage(unit.id, stage.id, { blockReason: reason, note }), "Tahap ditandai terhambat.")}>{busy ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={14} />} Tandai terhambat</Button></div>
    </div>
  ); else if (mode === "pause") body = (
    <div className="space-y-2" data-testid="v1-pause-form">
      <label className="block text-[11.5px] font-semibold text-ink2">Alasan jeda *<select className={`${INPUT} mt-1`} value={pauseReason} onChange={(e) => setPauseReason(e.target.value)}>{Object.entries(PAUSE_REASON_REAL).map(([k, r]) => <option key={k} value={k}>{r.label}</option>)}</select></label>
      <textarea rows={2} className={INPUT} placeholder={pauseReason === "OTHER" ? "Jelaskan alasannya *" : "Catatan (opsional)"} value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="flex gap-2"><Button size="sm" variant="ghost" className="flex-1" onClick={() => setMode(null)}>Batal</Button><Button size="sm" variant="secondary" className="flex-1" data-testid="v1-pause-save" disabled={busy || !pauseFormValid({ reason: pauseReason, note })} onClick={() => run(() => api.pauseUnitStage(unit.id, stage.id, { reason: pauseReason, note }), "Tahap dijeda.")}>{busy ? <Loader2 size={14} className="animate-spin" /> : <PauseCircle size={14} />} Jeda</Button></div>
    </div>
  ); else body = (
    <div className="space-y-2"><p className="m-0 text-[12.5px] text-ink2">Sedang berjalan: <b>{label}</b></p>
      <Button size="sm" className="w-full" data-testid="v1-stage-complete" onClick={() => setMode("complete")}><CheckCircle2 size={14} /> Tandai selesai</Button>
      <Button size="sm" variant="secondary" className="w-full" data-testid="v1-stage-pause" onClick={() => setMode("pause")}><PauseCircle size={14} /> Jeda</Button>
      <Button size="sm" variant="ghost" className="w-full" data-testid="v1-stage-fail" onClick={() => setMode("fail")}><AlertTriangle size={14} /> Tandai terhambat</Button></div>
  );

  return (
    <section className="rounded-btn border border-line p-3" data-testid="v1-stage">
      <h3 className="m-0 mb-2 text-[13px] font-bold text-ink">Tahap & QC (V1)</h3>
      <div className="space-y-2">
        {body}
        <Msg kind={msg.kind} testid="v1-stage-msg">{msg.text}</Msg>
      </div>
      {canAssign && cur && (
        <div className="mt-3 border-t border-line pt-3" data-testid="v1-assign">
          <dl className="m-0 mb-2 space-y-1 text-[12px]"><div className="flex justify-between"><dt className="text-ink3">Work center</dt><dd className="m-0 text-ink" data-testid="v1-assign-wc">{data.workCenter?.name || "—"}</dd></div><div className="flex justify-between"><dt className="text-ink3">Ditugaskan</dt><dd className="m-0 text-ink" data-testid="v1-assign-op">{data.assignedOperator?.name || "Belum ditugaskan"}</dd></div></dl>
          {!assign.open ? <Button size="sm" variant="secondary" className="w-full" data-testid="v1-assign-open" onClick={openAssign}>Tugaskan work center / operator</Button> : (
            <div className="space-y-2">
              <label className="block text-[11.5px] font-semibold text-ink2">Work center<select data-testid="v1-assign-wc-select" className={`${INPUT} mt-1`} value={assign.wc} onChange={(e) => setAssign({ ...assign, wc: e.target.value })}><option value="">— Tidak ditugaskan —</option>{(assign.refs?.wcs || []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
              <label className="block text-[11.5px] font-semibold text-ink2">Operator<select data-testid="v1-assign-op-select" className={`${INPUT} mt-1`} value={assign.op} onChange={(e) => setAssign({ ...assign, op: e.target.value })}><option value="">— Tidak ditugaskan —</option>{(assign.refs?.ops || []).map((o) => <option key={o.id} value={o.id}>{o.user?.name}</option>)}</select></label>
              <div className="flex gap-2"><Button size="sm" variant="ghost" className="flex-1" onClick={() => setAssign({ ...assign, open: false })}>Batal</Button>
                <Button size="sm" className="flex-1" data-testid="v1-assign-save" disabled={busy} onClick={() => run(async () => { await api.assignUnitStage(unit.id, stage.id, { workCenterId: assign.wc || null, operatorId: assign.op || null }); setAssign({ ...assign, open: false }); }, "Penugasan tersimpan.")}>Simpan</Button></div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
