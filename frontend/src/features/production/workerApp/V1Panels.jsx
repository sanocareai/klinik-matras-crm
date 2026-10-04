import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Camera, CheckCircle2, Loader2, PauseCircle, PlayCircle, WifiOff, X } from "lucide-react";
import { api } from "@/api.js";
import { useOnline } from "@/components/StandaloneShell.jsx";
import { compressImage } from "@/utils/compressImage.js";
import { BLOCK_REASON_REAL, PAUSE_REASON_REAL } from "@/features/bengkel/unitStatus.js";
import { canMaterialV1, completeFormValid, failFormValid, pauseFormValid } from "@/features/production/unitV1ActionsModel.js";
import { primaryActionV1, submitState } from "./workerAppModel.js";

// Jalur V1 (unit non-cohort) di Aplikasi Meja: endpoint, izin, dan engine V1 yang SAMA dengan drawer Unit 360 (UnitV1Stage/UnitV1Materials) — tata letak ramah jempol.
// TIDAK ada: lewati tahap, ubah rute, putusan QC, penyelesaian blokir (itu pekerjaan Lead/QC di Unit 360). Server menegakkan izin & kepemilikan (409 bila V2 memiliki unit).
const FIELD = "block w-full rounded-btn border border-line bg-surface px-3 py-3 text-[15px] text-ink outline-none focus:border-accent";

function Sheet({ title, subtitle, onClose, children, footer }) {
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 flex flex-col bg-base">
      <div className="flex items-center gap-2 border-b border-line bg-surface px-3 py-2" style={{ paddingTop: "calc(0.5rem + env(safe-area-inset-top))" }}>
        <button type="button" onClick={onClose} aria-label="Tutup" className="flex h-11 w-11 items-center justify-center rounded-btn text-ink2 hover:bg-hovertint"><X size={20} aria-hidden /></button>
        <div className="min-w-0 flex-1"><p className="m-0 truncate text-[12px] text-ink3">{subtitle}</p><p className="m-0 truncate text-[16px] font-bold text-ink">{title}</p></div>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-4">{children}</div>
      <div className="space-y-2 border-t border-line bg-surface px-3 pt-3" style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}>{footer}</div>
    </div>
  );
}
const OfflineNote = () => <p role="status" className="m-0 flex items-start gap-2 rounded-btn bg-orangebg px-3 py-2 text-[12.5px] font-semibold text-orange"><WifiOff size={15} className="mt-px shrink-0" aria-hidden /> {submitState({ online: false, busy: false }).reason}</p>;

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
    <div className="space-y-2">
      <label className="flex min-h-[56px] cursor-pointer items-center justify-center gap-2 rounded-btn border-2 border-dashed border-line text-[14px] font-semibold text-ink2">
        {busy ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <Camera size={18} aria-hidden />}{photos.length ? `${photos.length} foto siap` : "Ambil / pilih foto"}
        <input data-testid="v1-photo-input" type="file" accept="image/*" capture="environment" multiple hidden onChange={pick} disabled={busy || disabled} />
      </label>
      {photos.length > 0 && <div className="flex flex-wrap gap-2">{photos.map((u) => <img key={u} src={u} alt="Foto dokumentasi" className="h-16 w-16 rounded-btn object-cover" />)}</div>}
    </div>
  );
}

// Batang aksi lengket: SATU aksi utama sesuai keadaan tahap dari server + aksi sekunder (Jeda/Terhambat) hanya saat tahap berjalan.
export function V1ActionBar({ job, timeline, roles, onChanged }) {
  const online = useOnline();
  const action = primaryActionV1(timeline, roles);
  const unitId = job.unitId;
  const [sheet, setSheet] = useState(null); // complete | pause | block
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ kind: "", text: "" });
  const [note, setNote] = useState(""); const [photos, setPhotos] = useState([]);
  const [pauseReason, setPauseReason] = useState("BREAK"); const [blockReason, setBlockReason] = useState("MATERIAL_SHORTAGE");
  useEffect(() => { setSheet(null); setNote(""); setPhotos([]); setMsg({ kind: "", text: "" }); }, [unitId, action.kind, action.stage?.id]);

  const run = useCallback(async (fn, okText) => {
    setBusy(true); setMsg({ kind: "", text: "" });
    try { await fn(); setSheet(null); setNote(""); setPhotos([]); setMsg({ kind: "ok", text: okText }); await onChanged?.(); }
    catch (e) { setMsg({ kind: "error", text: e.message || "Gagal" }); await onChanged?.(); } finally { setBusy(false); }
  }, [onChanged]);
  const gate = submitState({ online, busy });
  const stage = action.stage;

  return (
    <>
      <div className="wa-actionbar" data-testid="v1-actionbar"><div className="wa-actionbar-inner">
        {msg.text && <p role={msg.kind === "error" ? "alert" : "status"} data-testid="v1-action-msg" className={`m-0 rounded-btn px-3 py-2 text-[13px] ${msg.kind === "error" ? "bg-redbg text-red" : "bg-greenbg text-green"}`}>{msg.text}</p>}
        {!online && <OfflineNote />}
        {action.kind === "NONE" && <p data-testid="v1-no-action" className="m-0 rounded-btn bg-inset px-3 py-3 text-[13.5px] font-semibold text-ink2">{action.reason}</p>}
        {action.kind === "START" && <button type="button" className="wa-primary" data-mutates data-testid="v1-primary" disabled={gate.disabled} onClick={() => run(() => api.startUnitStage(unitId), "Tahap dimulai.")}>{busy ? <Loader2 size={20} className="animate-spin" aria-hidden /> : <PlayCircle size={21} aria-hidden />} {action.label}</button>}
        {action.kind === "RESUME" && <button type="button" className="wa-primary" data-mutates data-testid="v1-primary" disabled={gate.disabled} onClick={() => run(() => api.resumeUnitStage(unitId, stage.id), "Tahap dilanjutkan.")}>{busy ? <Loader2 size={20} className="animate-spin" aria-hidden /> : <PlayCircle size={21} aria-hidden />} {action.label}</button>}
        {action.kind === "COMPLETE" && (
          <>
            <button type="button" className="wa-primary" data-testid="v1-primary" disabled={gate.disabled} onClick={() => setSheet("complete")}><CheckCircle2 size={21} aria-hidden /> {action.label}</button>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" data-testid="v1-pause-open" disabled={gate.disabled} onClick={() => setSheet("pause")} className="flex min-h-[48px] items-center justify-center gap-1.5 rounded-btn bg-inset text-[14px] font-bold text-ink2 disabled:opacity-50"><PauseCircle size={17} aria-hidden /> Jeda</button>
              <button type="button" data-testid="v1-block-open" disabled={gate.disabled} onClick={() => setSheet("block")} className="flex min-h-[48px] items-center justify-center gap-1.5 rounded-btn bg-redbg text-[14px] font-bold text-red disabled:opacity-50"><AlertTriangle size={17} aria-hidden /> Terhambat</button>
            </div>
          </>
        )}
      </div></div>

      {sheet === "complete" && (
        <Sheet title={action.label} subtitle={`Jalur V1 · ${job.unitCode}`} onClose={() => setSheet(null)} footer={<>
          {!online && <OfflineNote />}
          <button type="button" className="wa-primary" data-mutates data-testid="v1-complete-save" disabled={gate.disabled || !completeFormValid({ needsPhoto: action.needsPhoto, photos })}
            onClick={() => run(() => api.completeUnitStage(unitId, stage.id, { photoUrls: photos, note: note.trim() || undefined }), "Tahap selesai.")}>{busy ? <><Loader2 size={20} className="animate-spin" aria-hidden /> Mengirim…</> : "Kirim — tandai selesai"}</button></>}>
          <PhotoPicker unitId={unitId} photos={photos} setPhotos={setPhotos} disabled={!online} onError={(t) => setMsg({ kind: "error", text: t })} />
          {action.needsPhoto && photos.length === 0 && <p className="m-0 text-[13px] font-semibold text-orange">Tahap ini wajib foto dokumentasi.</p>}
          <textarea rows={3} className={FIELD} placeholder="Catatan (opsional)" value={note} onChange={(e) => setNote(e.target.value)} />
          {msg.kind === "error" && <p role="alert" className="m-0 rounded-btn bg-redbg px-3 py-2 text-[13px] text-red">{msg.text}</p>}
        </Sheet>
      )}
      {sheet === "pause" && (
        <Sheet title="Jeda tahap" subtitle={`Jalur V1 · ${job.unitCode}`} onClose={() => setSheet(null)} footer={<>
          {!online && <OfflineNote />}
          <button type="button" className="wa-primary" data-mutates data-testid="v1-pause-save" disabled={gate.disabled || !pauseFormValid({ reason: pauseReason, note })}
            onClick={() => run(() => api.pauseUnitStage(unitId, stage.id, { reason: pauseReason, note: note.trim() || undefined }), "Tahap dijeda.")}>Jeda sekarang</button></>}>
          <label className="block text-[13px] font-semibold text-ink2">Alasan jeda *<select className={`${FIELD} mt-1`} value={pauseReason} onChange={(e) => setPauseReason(e.target.value)}>{Object.entries(PAUSE_REASON_REAL).map(([k, r]) => <option key={k} value={k}>{r.label}</option>)}</select></label>
          <textarea rows={3} className={FIELD} placeholder={pauseReason === "OTHER" ? "Jelaskan alasannya *" : "Catatan (opsional)"} value={note} onChange={(e) => setNote(e.target.value)} />
          {msg.kind === "error" && <p role="alert" className="m-0 rounded-btn bg-redbg px-3 py-2 text-[13px] text-red">{msg.text}</p>}
        </Sheet>
      )}
      {sheet === "block" && (
        <Sheet title="Tandai terhambat" subtitle={`Jalur V1 · ${job.unitCode}`} onClose={() => setSheet(null)} footer={<>
          {!online && <OfflineNote />}
          <button type="button" className="flex min-h-[60px] w-full items-center justify-center rounded-[18px] bg-red text-[17px] font-extrabold text-white disabled:opacity-50" data-mutates data-testid="v1-block-save" disabled={gate.disabled || !failFormValid({ reason: blockReason, note })}
            onClick={() => run(() => api.failUnitStage(unitId, stage.id, { blockReason, note: note.trim() || undefined }), "Hambatan tercatat — Lead akan menindaklanjuti.")}>Catat hambatan</button></>}>
          <label className="block text-[13px] font-semibold text-ink2">Alasan hambatan *<select className={`${FIELD} mt-1`} value={blockReason} onChange={(e) => setBlockReason(e.target.value)}>{Object.entries(BLOCK_REASON_REAL).map(([k, r]) => <option key={k} value={k}>{r.label}</option>)}</select></label>
          <textarea rows={3} className={FIELD} placeholder={blockReason === "OTHER" ? "Jelaskan alasannya *" : "Catatan (opsional)"} value={note} onChange={(e) => setNote(e.target.value)} />
          {msg.kind === "error" && <p role="alert" className="m-0 rounded-btn bg-redbg px-3 py-2 text-[13px] text-red">{msg.text}</p>}
        </Sheet>
      )}
    </>
  );
}

// Bahan Digunakan (V1): ledger stok yang sama dengan Gudang (server menolak saldo negatif). Hanya peran dengan izin bahan yang melihat formulir.
export function V1MaterialsPanel({ unitId, roles, onChanged }) {
  const online = useOnline();
  const canWrite = canMaterialV1(roles);
  const [usage, setUsage] = useState(null); const [catalog, setCatalog] = useState([]);
  const [form, setForm] = useState({ materialId: "", qty: "", note: "" });
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState({ kind: "", text: "" });
  const load = useCallback(() => api.getUnitMaterials(unitId).then(setUsage).catch((e) => setMsg({ kind: "error", text: e.message })), [unitId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (canWrite) api.getMaterials({ active: true }).then((d) => setCatalog(Array.isArray(d) ? d : d.materials || [])).catch(() => {}); }, [canWrite]);
  async function add() {
    setBusy(true); setMsg({ kind: "", text: "" });
    try { await api.addUnitMaterial(unitId, { materialId: form.materialId, qty: Number(form.qty), note: form.note }); setForm({ materialId: "", qty: "", note: "" }); await load(); onChanged?.(); setMsg({ kind: "ok", text: "Pemakaian bahan tercatat." }); }
    catch (e) { setMsg({ kind: "error", text: e.message || "Gagal mencatat" }); } finally { setBusy(false); }
  }
  const totals = usage?.totals || [];
  return (
    <div data-testid="v1-materials" className="space-y-3">
      <p className="m-0 text-[12.5px] text-ink3">Jalur V1 tidak punya rencana bahan; pemakaian dicatat langsung dan stok gudang berkurang otomatis.</p>
      {usage && (totals.length ? <ul className="m-0 list-none space-y-1.5 p-0">{totals.map((t) => <li key={t.material.id} className="flex items-center justify-between rounded-btn bg-inset px-3 py-2 text-[14px]"><span className="min-w-0 truncate font-semibold text-ink">{t.material.name}</span><span className="shrink-0 tabular-nums text-ink2">{t.usedQty} {t.material.unit || ""}</span></li>)}</ul> : <p className="m-0 text-[13.5px] text-ink3">Belum ada pemakaian bahan.</p>)}
      {canWrite ? (
        <div className="space-y-2 rounded-btn bg-inset p-3">
          <select data-testid="v1-material-select" aria-label="Pilih bahan" className={FIELD} value={form.materialId} onChange={(e) => setForm({ ...form, materialId: e.target.value })}><option value="">Pilih bahan…</option>{catalog.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
          <div className="grid grid-cols-[1fr_2fr] gap-2">
            <input data-testid="v1-material-qty" aria-label="Jumlah" inputMode="decimal" className={FIELD} placeholder="Jumlah" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} />
            <input aria-label="Catatan bahan" className={FIELD} placeholder="Catatan (opsional)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </div>
          {!online && <OfflineNote />}
          <button type="button" data-mutates data-testid="v1-material-save" className="flex min-h-[52px] w-full items-center justify-center rounded-btn bg-accent text-[15px] font-bold text-white disabled:opacity-50" disabled={busy || !online || !form.materialId || !Number(form.qty)} onClick={add}>{busy ? "Mencatat…" : "Catat pemakaian"}</button>
        </div>
      ) : <p className="m-0 text-[13px] text-ink3">Peran Anda tidak mencatat pemakaian bahan.</p>}
      {msg.text && <p role={msg.kind === "error" ? "alert" : "status"} data-testid="v1-material-msg" className={`m-0 rounded-btn px-3 py-2 text-[13px] ${msg.kind === "error" ? "bg-redbg text-red" : "bg-greenbg text-green"}`}>{msg.text}</p>}
    </div>
  );
}
