import React, { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Camera, ClipboardCheck, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { api } from "@/api.js";
import { compressImage } from "@/utils/compressImage.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import {
  FAIL_VERDICTS, FIT_VERDICTS, PREFERENCE_OVERRIDES, QC_MODES, QC_TABS, RESOLUTION_LABEL, buildInspectionBody, canRecordInspection, conflictKindLabel, emptyStateCopy,
  inspectionBadgeFor, nextInspectionSummary, qcErrorMessage, qcStateBadgeFor, reworkStageOptions, validateInspectionForm, validateNoteForm, MIN_WAIVE_REASON,
} from "@/features/production/qcHandoff.js";
import { STAGE_STATUS_LABEL } from "@/features/production/workshopExecution.js";
import { UnitCard } from "@/features/production/UnitCard.jsx";
import { UnitOverviewDrawer } from "@/features/production/UnitOverviewDrawer.jsx";
import { mergeQcWithViews } from "@/features/production/unitCardModel.js";
import { wibDate } from "@/features/production/experience.js";

// Antrean QC Production V2 (Production Workshop + Warehouse V2, P6): putusan QC Lulus/Gagal/Waive dengan bukti foto, rework terkontrol
// (tahap rework dipilih eksplisit, bahan tambahan lewat jalur reservasi/Material Issue), tindak lanjut penolakan Gudang, dan rekonsiliasi
// konflik override V1. Data hanya muncul bila reader V2 (production_v2_reader) diaktifkan server untuk cohort unit terkait (fail-closed,
// bukan error); halaman ini TIDAK mengubah flag apa pun. Server menegakkan ulang izin (QC_WRITE/QC_WAIVE), revisi, dan konsistensi.
// Logika murni: features/production/qcHandoff.js.

const waktu = (s) => (s ? new Date(s).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const field = "mt-1 w-full rounded-btn border border-line bg-transparent px-2 py-2 text-[13px] text-ink";

// Satu kunci idempotensi per NIAT perintah: dipakai ulang bila pengguna mengulang setelah galat jaringan, diganti setelah sukses/konflik.
function useIntentKeys() {
  const ref = useRef({});
  return {
    get: (action) => { if (!ref.current[action]) ref.current[action] = `web-qc-${action}-${crypto.randomUUID()}`; return ref.current[action]; },
    reset: (action) => { delete ref.current[action]; },
  };
}

function QueueCard({ item, onOpen }) {
  const badge = qcStateBadgeFor(item.state);
  return (
    <Card className="flex cursor-pointer flex-col gap-3 p-4 hover:bg-hovertint" onClick={() => onOpen(item)}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[13px] font-bold text-ink">{item.unit.unitCode}</p>
          <p className="text-[12px] text-ink3">{item.unit.orderNumber ? `Order ${item.unit.orderNumber}` : "Tanpa nomor order"}{item.unit.category ? ` · ${item.unit.category}` : ""}</p>
        </div>
        <Badge variant={badge.variant}>{badge.label}</Badge>
      </div>
      <dl className="space-y-1 text-[12px]">
        <div className="flex justify-between"><dt className="text-ink3">Workshop</dt><dd className="text-ink">{item.workCenter?.name || "—"}</dd></div>
        <div className="flex justify-between"><dt className="text-ink3">Operator</dt><dd className="text-ink">{item.operator?.name || "—"}</dd></div>
        {item.lastInspection && <div className="flex justify-between"><dt className="text-ink3">QC terakhir</dt><dd className="text-ink">#{item.lastInspection.version} · {inspectionBadgeFor(item.lastInspection.result).label}</dd></div>}
      </dl>
      {item.conflict && <p className="flex items-center gap-1 text-[12px] text-red"><AlertTriangle size={13} /> {conflictKindLabel(item.conflict.kind)}</p>}
    </Card>
  );
}

function PhotoPicker({ unitId, photos, onChange, disabled, onError }) {
  const [uploading, setUploading] = useState(false);
  const handle = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setUploading(true);
    try {
      const compressed = await Promise.all(files.map((f) => compressImage(f)));
      const fd = new FormData();
      compressed.forEach((f) => fd.append("photos", f));
      const { urls } = await api.uploadUnitPhotos(unitId, fd);
      onChange([...photos, ...urls]);
    } catch (err) { onError(err.message || "Gagal mengunggah foto"); } finally { setUploading(false); e.target.value = ""; }
  };
  return (
    <div className="space-y-2">
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-btn border border-line px-3 py-2 text-[12.5px] font-semibold text-ink2 hover:bg-hovertint">
        {uploading ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
        {photos.length > 0 ? `${photos.length} foto siap` : "Ambil / Pilih Foto Bukti"}
        <input type="file" accept="image/*" capture="environment" multiple hidden onChange={handle} disabled={disabled || uploading} />
      </label>
      {photos.length > 0 && <div className="flex flex-wrap gap-2">{photos.map((u) => <img key={u} src={u} alt="Foto bukti QC" className="h-12 w-12 rounded object-cover" />)}</div>}
    </div>
  );
}

// Pemilih bahan berbasis pencarian (endpoint produksi /production-v2/materials/search — izin UNIT_STAGE_WRITE yang SUDAH dimiliki QC/PIC,
// tanpa harga/HPP). Sebelumnya memuat SELURUH katalog lewat /inventory/materials: peran QC mendapat 403 (daftar kosong, galat konsol)
// sehingga "Ajukan Bahan Tambahan Rework" tidak bisa dipakai QC Lead (ditemukan lewat sandbox QA).
function MaterialPicker({ value, disabled, onPick }) {
  const [q, setQ] = useState("");
  const [label, setLabel] = useState("");
  const [results, setResults] = useState([]);
  useEffect(() => {
    const t = q.trim();
    if (label || t.length < 2) { setResults([]); return undefined; }
    const id = setTimeout(() => { api.searchProductionV2Materials(t).then((r) => setResults(r.items || [])).catch(() => setResults([])); }, 250);
    return () => clearTimeout(id);
  }, [q, label]);
  useEffect(() => { if (!value) { setLabel(""); } }, [value]);
  return (
    <div className="relative min-w-0 flex-1">
      <input aria-label="Bahan tambahan" className={`${field} mt-0`} placeholder="Cari kode/nama bahan…" disabled={disabled} value={label || q}
        onChange={(e) => { setLabel(""); onPick(""); setQ(e.target.value); }} />
      {results.length > 0 && (
        <ul data-testid="material-picker-results" className="absolute z-20 mt-1 max-h-52 w-full list-none overflow-auto rounded-btn border border-line bg-surface p-1 shadow-md">
          {results.map((m) => (
            <li key={m.id}><button type="button" data-material-code={m.code} className="flex min-h-[40px] w-full items-center rounded-btn px-2 text-left text-[12.5px] text-ink hover:bg-hovertint"
              onClick={() => { setLabel(`${m.code} · ${m.name}`); setResults([]); onPick(m.id); }}>{m.code} · {m.name}</button></li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MaterialRows({ rows, onChange, disabled }) {
  const update = (index, patch) => onChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-2">
      {rows.map((row, index) => (
        <div key={index} className="flex items-center gap-2">
          <MaterialPicker value={row.materialId} disabled={disabled} onPick={(id) => update(index, { materialId: id })} />
          <input aria-label="Jumlah" type="number" min="0" step="any" className={`${field} mt-0 w-24`} value={row.qty} disabled={disabled} onChange={(e) => update(index, { qty: e.target.value })} />
          <button type="button" aria-label="Hapus baris bahan" className="text-ink3 hover:text-red" disabled={disabled} onClick={() => onChange(rows.filter((_, i) => i !== index))}><Trash2 size={15} /></button>
        </div>
      ))}
      <Button size="sm" variant="ghost" type="button" disabled={disabled} onClick={() => onChange([...rows, { materialId: "", qty: "" }])}><Plus size={14} /> Tambah Bahan</Button>
    </div>
  );
}

function InspectionForm({ run, busy, onSubmit, onError }) {
  const generic = run.qcProfile === "GENERIC";
  const unconfirmed = run.qcProfile === "UNCONFIRMED"; // jenis produk belum jelas: TIDAK ada fallback ke uji kasur — keputusan ditahan sampai Sales mengonfirmasi jenis pada order
  const cornerHeld = run.track === "BUILD" && run.cornerRequired == null; // Corner harus dikonfirmasi Lead pada rencana sebelum QC lulus/waive // divan/sofa (jalur pengerjaan): pemeriksaan hasil tanpa uji berat badan/tekstur kasur
  const [form, setForm] = useState({ mode: "PASS", photoUrls: [], referenceWeightKg: "", fitVerdict: "PAS", customerPreferenceOverride: "", educationGiven: false, note: "", reworkStageId: "", reason: "", materials: [] });
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const stages = reworkStageOptions(run);
  const mode = form.mode;
  const submit = () => {
    const profile = generic ? "GENERIC" : "KASUR";
    const check = validateInspectionForm(form, { profile });
    if (!check.valid) { onError(check.errors[0]); return; }
    onSubmit(buildInspectionBody(form, run.revision, { profile }));
  };
  return (
    <section aria-label="Catat hasil QC" className="space-y-3 rounded-card border border-line p-3">
      {unconfirmed && <p data-testid="qc-unconfirmed-hold" role="alert" className="m-0 rounded-btn bg-orangebg px-3 py-2 text-[12.5px] text-orange"><b>Putusan QC ditahan.</b> Jenis produk belum jelas{run.productClassProblem ? ` — ${run.productClassProblem}` : ""}. Uji berat badan kasur tidak dipakai sebagai cadangan; minta Sales memperbaiki jenis produk pada order.</p>}
      {cornerHeld && <p data-testid="qc-corner-hold" role="alert" className="m-0 rounded-btn bg-orangebg px-3 py-2 text-[12.5px] text-orange"><b>Lulus/Waive ditahan.</b> Kebutuhan Corner belum dikonfirmasi pada rencana — Production Lead mengonfirmasinya di Unit 360 › Proses. (Gagal/rework tetap bisa dicatat.)</p>}
      <h3 className="text-[12.5px] font-bold text-ink">{generic ? "Catat Pemeriksaan Hasil" : "Catat Hasil QC"}</h3>
      {generic && <p data-testid="qc-generic-note" className="m-0 rounded-btn bg-inset px-3 py-2 text-[12px] text-ink2">Produk non-kasur (divan/sofa): periksa hasil pengerjaan terhadap spesifikasi pesanan. Tidak ada uji berat badan/tekstur kasur.</p>}
      <div role="tablist" aria-label="Jenis hasil QC" className="flex gap-1">
        {QC_MODES.map((m) => (
          <button key={m.key} role="tab" aria-selected={mode === m.key} type="button" onClick={() => set({ mode: m.key, fitVerdict: m.key === "FAIL" ? "TERLALU_KERAS" : "PAS" })}
            className={`rounded-chip px-3 py-1.5 text-[12.5px] font-semibold ${mode === m.key ? "bg-accentbg text-accent" : "text-ink3 hover:bg-hovertint"}`}>{m.label}</button>
        ))}
      </div>

      {mode === "WAIVED" ? (
        <div className="space-y-2">
          <p className="rounded-btn bg-orangebg px-3 py-2 text-[12px] text-orange">Waive QC dicatat sebagai QC_WAIVED (bukan Lulus), tanpa berat acuan. Hanya ADMIN/OWNER. Alasan tercatat di audit.</p>
          <label className="block text-[12px] text-ink3">Alasan waive (minimal {MIN_WAIVE_REASON} karakter)
            <textarea className={field} rows={3} value={form.reason} onChange={(e) => set({ reason: e.target.value })} />
          </label>
        </div>
      ) : (
        <div className="space-y-2">
          {!generic && <label className="block text-[12px] text-ink3">Berat acuan (kg)
            <input type="number" min="1" step="1" className={field} value={form.referenceWeightKg} onChange={(e) => set({ referenceWeightKg: e.target.value })} />
          </label>}
          {!generic && <label className="block text-[12px] text-ink3">Hasil uji berat badan
            <select className={field} value={form.fitVerdict} onChange={(e) => set({ fitVerdict: e.target.value })}>
              {(mode === "FAIL" ? FAIL_VERDICTS : FIT_VERDICTS).map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
            </select>
          </label>}
          {!generic && mode === "PASS" && form.fitVerdict !== "PAS" && (
            <div className="space-y-2 rounded-btn bg-inset p-2">
              <label className="block text-[12px] text-ink3">Override preferensi customer
                <select className={field} value={form.customerPreferenceOverride} onChange={(e) => set({ customerPreferenceOverride: e.target.value })}>
                  <option value="">— Pilih —</option>
                  {PREFERENCE_OVERRIDES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-2 text-[12px] text-ink2"><input type="checkbox" checked={form.educationGiven} onChange={(e) => set({ educationGiven: e.target.checked })} /> Edukasi kepada customer sudah diberikan</label>
            </div>
          )}
          <label className="block text-[12px] text-ink3">Catatan{mode === "FAIL" ? " temuan (wajib)" : " (opsional)"}
            <textarea className={field} rows={2} value={form.note} onChange={(e) => set({ note: e.target.value })} />
          </label>
          <PhotoPicker unitId={run.unit.id} photos={form.photoUrls} onChange={(photoUrls) => set({ photoUrls })} disabled={busy} onError={onError} />
          {form.photoUrls.length === 0 && <p className="text-[11px] text-orange">Foto bukti wajib untuk hasil Lulus/Gagal</p>}
          {mode === "FAIL" && (
            <>
              <label className="block text-[12px] text-ink3">Tahap rework (sebelum gerbang QC — unit wajib diuji ulang)
                <select className={field} value={form.reworkStageId} onChange={(e) => set({ reworkStageId: e.target.value })}>
                  <option value="">— Pilih tahap —</option>
                  {stages.map((s) => <option key={s.id} value={s.id}>{s.order}. {s.label}</option>)}
                </select>
              </label>
              <div>
                <p className="text-[12px] text-ink3">Bahan tambahan (opsional) — diminta lewat reservasi &amp; Material Issue; rework baru bisa dimulai setelah Gudang menyerahkan bahan.</p>
                <MaterialRows rows={form.materials} onChange={(rows) => set({ materials: rows })} disabled={busy} />
              </div>
            </>
          )}
        </div>
      )}
      <Button size="sm" data-mutates onClick={submit} disabled={busy || (unconfirmed && mode !== "WAIVED") || (cornerHeld && mode !== "FAIL")}><ClipboardCheck size={14} /> {busy ? "Menyimpan…" : mode === "PASS" ? "Simpan — Lulus" : mode === "FAIL" ? "Simpan — Gagal (Buka Rework)" : "Simpan — Waive QC"}</Button>
    </section>
  );
}

function ConflictPanel({ run, busy, onOpen, onResolve, onError }) {
  const exception = run.conflict?.exception;
  const [resolution, setResolution] = useState("");
  const [note, setNote] = useState("");
  const allowed = exception?.allowedResolutions || [];
  return (
    <section aria-label="Konflik status" className="space-y-2 rounded-card border border-red p-3">
      <h3 className="flex items-center gap-1 text-[12.5px] font-bold text-red"><AlertTriangle size={14} /> Konflik status unit vs Production Run</h3>
      <p className="text-[12px] text-ink2">{conflictKindLabel(exception?.kind || run.conflict?.detected?.kind)}. Semua perintah QC/produksi untuk run ini ditolak sampai konflik diselesaikan — sistem tidak menebak atau menimpa status unit.</p>
      {!exception ? (
        <Button size="sm" data-mutates onClick={onOpen} disabled={busy}>Catat Konflik</Button>
      ) : (
        <div className="space-y-2">
          <label className="block text-[12px] text-ink3">Resolusi
            <select className={field} value={resolution} onChange={(e) => setResolution(e.target.value)}>
              <option value="">— Pilih resolusi —</option>
              {allowed.map((r) => <option key={r} value={r}>{RESOLUTION_LABEL[r]?.label || r}</option>)}
            </select>
          </label>
          {resolution && <p className="text-[11.5px] text-ink3">{RESOLUTION_LABEL[resolution]?.hint}</p>}
          <label className="block text-[12px] text-ink3">Catatan resolusi (wajib)
            <textarea className={field} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <Button size="sm" data-mutates disabled={busy} onClick={() => {
            if (!resolution) { onError("Pilih resolusi terlebih dahulu"); return; }
            if (note.trim().length < 3) { onError("Catatan resolusi wajib diisi (minimal 3 karakter)"); return; }
            onResolve({ exceptionId: exception.id, expectedRevision: exception.revision, resolution, note: note.trim() });
          }}>Selesaikan Konflik</Button>
        </div>
      )}
    </section>
  );
}

function RunDetailModal({ runId, onClose, onChanged }) {
  const [run, setRun] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [action, setAction] = useState(null); // null | "reoffer" | "rework" | "cancel" | "material"
  const [note, setNote] = useState("");
  const [reworkStageId, setReworkStageId] = useState("");
  const [materialRows, setMaterialRows] = useState([{ materialId: "", qty: "" }]);
  const keys = useIntentKeys();

  const load = useCallback(() => {
    setLoading(true);
    return api.getQcRun(runId).then(setRun).catch((e) => setError(e.message || "Gagal memuat detail")).finally(() => setLoading(false));
  }, [runId]);
  useEffect(() => { load(); }, [load]);

  const execute = async (name, call, success) => {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await call(keys.get(name));
      keys.reset(name);
      setNotice(success(result));
      setAction(null); setNote("");
      await load(); onChanged();
    } catch (e) {
      if (e.status && e.status < 500) keys.reset(name);
      setError(qcErrorMessage(e));
      if (["QC_REVISION_CONFLICT", "QC_EXCEPTION_REVISION_CONFLICT", "PRODUCTION_RUN_INCONSISTENT", "QC_NOT_AWAITING"].includes(e.code)) await load();
    } finally { setBusy(false); }
  };

  const badge = qcStateBadgeFor(run?.state);
  const lastHandoff = run?.handoffs?.at(-1);
  const stageOptions = reworkStageOptions(run);
  const inRework = run?.state === "REWORK";
  const latest = run?.inspections?.at(-1);
  const canAddMaterial = inRework && latest?.result === "FAIL_REWORK" && !run.supplementalIssues?.some((s) => s.inspectionId === latest.id && s.status !== "CANCELLED") && !run.stages?.some((s) => !s.isQcGate && s.status === "ACTIVE");

  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title={run ? `QC ${run.unit.unitCode}` : "Detail QC"} description="Putusan QC, rework, penolakan Gudang, dan konflik status untuk unit ini.">
      <div className="space-y-3">
        {notice && <div className="rounded-btn bg-greenbg px-3 py-2 text-[12.5px] text-green">{notice}</div>}
        {error && <div role="alert" className="rounded-btn bg-redbg px-3 py-2 text-[12.5px] text-red">{error}</div>}
        {loading && !run ? <div className="h-32 animate-pulse rounded-card bg-inset" /> : !run ? null : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={badge.variant}>{badge.label}</Badge>
              <span className="text-[12px] text-ink3">Revisi run {run.revision}</span>
              {run.origin === "WORKSHOP_BORN" && <Badge variant="accent">Lahir di Workshop</Badge>}
              {run.track === "BUILD" && <Badge variant="neutral">{run.qcProfile === "GENERIC" ? "Pesanan non-kasur" : run.qcProfile === "UNCONFIRMED" ? "Jenis produk belum jelas" : "Pesanan kasur"}</Badge>}
            </div>
            {run.track === "BUILD" && (
              <section aria-label="Spesifikasi pesanan" data-testid="qc-build-spec" className="space-y-1 rounded-card border border-line p-3 text-[12.5px]">
                <h3 className="text-[12.5px] font-bold text-ink">Spesifikasi &amp; Racikan</h3>
                <p className="m-0 text-ink2"><span className="text-ink3">Layanan Sales: </span>{run.salesServices?.length ? run.salesServices.join(", ") : "—"}</p>
                {run.salesNotes && <p className="m-0 text-ink2"><span className="text-ink3">Catatan Sales: </span>{run.salesNotes}</p>}
                {run.qcProfile !== "GENERIC" && <p data-testid="qc-racikan" className="m-0 text-ink2"><span className="text-ink3">Racikan: </span>{[run.racikan?.fondasi && `Fondasi — ${run.racikan.fondasi}`, run.racikan?.lapisan && `Lapisan — ${run.racikan.lapisan}`].filter(Boolean).join(" · ") || "belum dicatat"}</p>}
                {run.buildNote && <p className="m-0 text-ink2"><span className="text-ink3">Pengerjaan: </span>{run.buildNote}</p>}
                <p data-testid="qc-corner-info" className="m-0 text-ink2"><span className="text-ink3">Corner: </span>{run.cornerRequired == null ? "belum dikonfirmasi" : run.cornerRequired ? "diperlukan" : `tidak diperlukan — ${run.cornerReason || ""}`}</p>
                {run.productClassProblem && <p data-testid="qc-product-problem" className="m-0 rounded-btn bg-orangebg px-2 py-1 text-orange">Jenis produk: {run.productClassProblem}</p>}
              </section>
            )}

            {run.conflict && <ConflictPanel run={run} busy={busy}
              onOpen={() => execute("exception-open", (key) => api.openRunException(runId, key), (r) => (r.alreadyOpen ? "Konflik sudah tercatat sebelumnya." : "Konflik dicatat."))}
              onResolve={({ exceptionId, expectedRevision, resolution, note: n }) => execute(`exception-resolve-${resolution}`, (key) => api.resolveRunException(exceptionId, { expectedRevision, resolution, note: n }, key), (r) => (r.replayed ? "Sudah diproses sebelumnya." : "Konflik diselesaikan."))}
              onError={setError} />}

            <section aria-label="Tahap produksi">
              <h3 className="mb-1 text-[12.5px] font-bold text-ink">Tahap Produksi</h3>
              <ol className="divide-y divide-line rounded-card border border-line">
                {run.stages.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 px-3 py-2 text-[12.5px]">
                    <span className="text-ink">{s.order}. {s.isQcGate && run.qcProfile === "GENERIC" ? "Pemeriksaan Hasil" : s.label}{s.isQcGate ? " · gerbang QC" : ""}</span>
                    <Badge variant={s.status === "COMPLETED" ? "success" : s.status === "AWAITING_QC" ? "warning" : s.status === "ACTIVE" ? "info" : "neutral"}>{STAGE_STATUS_LABEL[s.status] || s.status}</Badge>
                  </li>
                ))}
              </ol>
            </section>

            {canRecordInspection(run) && <InspectionForm run={run} busy={busy} onError={setError}
              onSubmit={(body) => execute("inspect", (key) => api.recordQcInspection(runId, body, key), nextInspectionSummary)} />}
            {run.state === "AWAITING_QC" && run.conflict && <p className="text-[12px] text-orange">Pencatatan QC ditutup selama ada konflik status.</p>}
            {run.state === "HANDOFF" && <p className="rounded-btn bg-inset px-3 py-2 text-[12px] text-ink2">Barang jadi sudah ditawarkan ke Gudang — menunggu keputusan di menu Terima Barang Jadi.</p>}
            {inRework && <p className="rounded-btn bg-inset px-3 py-2 text-[12px] text-ink2">Rework berjalan: lanjutkan tahap di Antrean Kerja. Setelah selesai, unit wajib kembali ke QC.</p>}

            {canAddMaterial && action !== "material" && <Button size="sm" variant="ghost" data-mutates onClick={() => setAction("material")}>Ajukan Bahan Tambahan Rework</Button>}
            {action === "material" && (
              <section aria-label="Bahan tambahan rework" className="space-y-2 rounded-card border border-line p-3">
                <h3 className="text-[12.5px] font-bold text-ink">Bahan Tambahan Rework</h3>
                <MaterialRows rows={materialRows} onChange={setMaterialRows} disabled={busy} />
                <div className="flex gap-2">
                  <Button size="sm" data-mutates disabled={busy} onClick={() => {
                    const lines = materialRows.filter((r) => r.materialId).map((r) => ({ materialId: r.materialId, qty: Number(r.qty) }));
                    if (!lines.length || lines.some((l) => !(l.qty > 0))) { setError("Isi bahan dan jumlah (> 0)"); return; }
                    execute("rework-material", (key) => api.requestReworkMaterial(runId, { expectedRevision: run.revision, lines }, key), () => "Permintaan bahan tambahan dibuat — menunggu Gudang menyerahkan bahan.");
                  }}>Ajukan</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setAction(null); setError(""); }} disabled={busy}>Batal</Button>
                </div>
              </section>
            )}

            {run.state === "REJECTED" && (
              <section aria-label="Penolakan Gudang" className="space-y-2 rounded-card border border-line p-3">
                <h3 className="text-[12.5px] font-bold text-red">Barang jadi ditolak Gudang</h3>
                <p className="text-[12px] text-ink2">{lastHandoff?.reason || "Tanpa alasan tercatat"}</p>
                {!action || action === "cancel" || action === "material" ? (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" data-mutates onClick={() => { setAction("reoffer"); setError(""); }}>Tawarkan Ulang</Button>
                    <Button size="sm" variant="ghost" data-mutates onClick={() => { setAction("rework"); setError(""); }}>Kembalikan ke Rework</Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {action === "rework" && (
                      <label className="block text-[12px] text-ink3">Tahap rework (sebelum gerbang QC)
                        <select className={field} value={reworkStageId} onChange={(e) => setReworkStageId(e.target.value)}>
                          <option value="">— Pilih tahap —</option>
                          {stageOptions.map((s) => <option key={s.id} value={s.id}>{s.order}. {s.label}</option>)}
                        </select>
                      </label>
                    )}
                    <label className="block text-[12px] text-ink3">Catatan tindakan koreksi (wajib)
                      <textarea className={field} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
                    </label>
                    <div className="flex gap-2">
                      <Button size="sm" data-mutates disabled={busy} onClick={() => {
                        const actionName = action === "rework" ? "REWORK" : "REOFFER";
                        const check = validateNoteForm({ note, action: actionName, reworkStageId });
                        if (!check.valid) { setError(check.error); return; }
                        execute(`handoff-${actionName}`, (key) => api.resolveHandoffRejection(runId, { expectedRevision: run.revision, action: actionName, note: note.trim(), reworkStageId: actionName === "REWORK" ? reworkStageId : undefined }, key),
                          (r) => (r.replayed ? "Sudah diproses sebelumnya." : actionName === "REWORK" ? "Kasus dikembalikan ke rework — unit wajib QC ulang." : "Barang jadi ditawarkan ulang ke Gudang."));
                      }}>Simpan Tindakan</Button>
                      <Button size="sm" variant="ghost" onClick={() => { setAction(null); setError(""); }} disabled={busy}>Batal</Button>
                    </div>
                  </div>
                )}
              </section>
            )}

            <section aria-label="Riwayat inspeksi">
              <h3 className="mb-1 text-[12.5px] font-bold text-ink">Riwayat Inspeksi QC</h3>
              {run.inspections.length === 0 ? <p className="text-[12px] text-ink3">Belum ada inspeksi.</p> : (
                <ul className="space-y-2">
                  {[...run.inspections].reverse().map((i) => {
                    const b = inspectionBadgeFor(i.result);
                    return (
                      <li key={i.id} className="rounded-btn bg-inset px-3 py-2 text-[12px] text-ink2">
                        <div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-ink">#{i.version}</span><Badge variant={b.variant}>{b.label}</Badge><span>{waktu(i.inspectedAt)}{i.inspector ? ` · ${i.inspector}` : ""}</span></div>
                        {i.overrideReason && <p className="mt-1">Alasan waive: {i.overrideReason}</p>}
                        {i.items.filter((it) => it.note).map((it) => <p key={it.itemCode} className="mt-1">{it.label}: {it.note}</p>)}
                        <div className="mt-1 flex flex-wrap gap-1">{i.items.flatMap((it) => it.photoUrls || []).map((u) => <img key={u} src={u} alt="Foto bukti QC" className="h-10 w-10 rounded object-cover" />)}</div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {run.supplementalIssues?.length > 0 && (
              <section aria-label="Bahan tambahan">
                <h3 className="mb-1 text-[12.5px] font-bold text-ink">Bahan Tambahan Rework</h3>
                <ul className="space-y-1">{run.supplementalIssues.map((s) => <li key={s.id} className="rounded-btn bg-inset px-3 py-2 text-[12px] text-ink2">{s.issueNumber} · {s.status} · {s.lines.map((l) => `${l.code} ×${l.qty}`).join(", ")}</li>)}</ul>
              </section>
            )}

            {run.handoffs?.length > 0 && (
              <section aria-label="Riwayat handoff barang jadi">
                <h3 className="mb-1 text-[12.5px] font-bold text-ink">Riwayat Handoff Barang Jadi</h3>
                <ul className="space-y-1">{run.handoffs.map((h) => <li key={h.id} className="rounded-btn bg-inset px-3 py-2 text-[12px] text-ink2">{h.status} · {waktu(h.offeredAt)}{h.location ? ` · ${h.location.code}` : ""}{h.reason ? ` — ${h.reason}` : ""}</li>)}</ul>
              </section>
            )}

            {!["CONFLICT"].includes(run.state) || !run.conflict ? (
              <div>
                {action === "cancel" ? (
                  <div className="space-y-2 rounded-card border border-line p-3">
                    <label className="block text-[12px] text-ink3">Alasan pembatalan run (wajib)
                      <textarea className={field} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
                    </label>
                    <div className="flex gap-2">
                      <Button size="sm" variant="destructive" data-mutates disabled={busy} onClick={() => {
                        if (note.trim().length < 3) { setError("Alasan pembatalan wajib diisi (minimal 3 karakter)"); return; }
                        execute("run-cancel", (key) => api.cancelProductionRun(runId, { expectedRevision: run.revision, reason: note.trim() }, key), () => "Production Run dibatalkan.");
                      }}>Batalkan Run</Button>
                      <Button size="sm" variant="ghost" onClick={() => { setAction(null); setError(""); }} disabled={busy}>Batal</Button>
                    </div>
                  </div>
                ) : <button type="button" data-mutates className="text-[12px] text-ink3 underline hover:text-red" onClick={() => { setAction("cancel"); setNote(""); setError(""); }}>Batalkan Production Run…</button>}
              </div>
            ) : null}
          </>
        )}
      </div>
    </Modal>
  );
}

export default function ProductionQc() {
  const [tab, setTab] = useState("AWAITING_QC");
  const [items, setItems] = useState(null);
  const [readerMode, setReaderMode] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedRunId, setSelectedRunId] = useState(null);
  const [cc, setCc] = useState(null);
  const [overviewUnitId, setOverviewUnitId] = useState(null);
  const [sweeping, setSweeping] = useState(false);
  const sweepKey = useRef(null);

  const load = useCallback(() => {
    setLoading(true); setError("");
    api.getQcQueue({ tab })
      .then((d) => { setItems(d.items || []); setReaderMode(d.readerMode || null); })
      .catch((e) => setError(e.message || "Gagal memuat antrean QC"))
      .finally(() => setLoading(false));
  }, [tab]);
  useEffect(() => { load(); }, [load]);
  // P9 UX — kartu QC = kartu Status Produksi yang SAMA (foto-pertama, Layanan Sales, PIC, tahap): dilengkapi lewat runId dari
  // Command Center (sumber tunggal pipeline). Gagal/OFF -> kartu QC lama tetap tampil (fallback), bukan kosong.
  useEffect(() => { api.getProductionV2CommandCenter().then(setCc).catch(() => setCc(null)); }, []);
  const merged = mergeQcWithViews(items, cc?.columns);
  const today = wibDate(0), tomorrow = wibDate(1);

  const sweep = async () => {
    setSweeping(true); setError(""); setNotice("");
    try {
      if (!sweepKey.current) sweepKey.current = `web-qc-sweep-${crypto.randomUUID()}`;
      const result = await api.sweepRunExceptions(sweepKey.current);
      sweepKey.current = null;
      setNotice(result.openedCount ? `${result.openedCount} konflik baru dicatat.` : "Tidak ada konflik baru.");
      load();
    } catch (e) { if (e.status && e.status < 500) sweepKey.current = null; setError(qcErrorMessage(e)); } finally { setSweeping(false); }
  };

  const kosong = !loading && items && items.length === 0;
  const copy = emptyStateCopy({ readerMode, tab });

  return (
    <PageContainer>
      <PageHeader
        title="Quality Control"
        subtitle="Antrean putusan QC — kartu & Unit 360 sama dengan Status Produksi. Lulus/Gagal/Waive, rework, penolakan Gudang, konflik status."
        actions={(
          <div className="flex gap-2">
            {tab === "CONFLICT" && <Button variant="ghost" size="sm" data-mutates onClick={sweep} disabled={sweeping}>{sweeping ? "Memindai…" : "Pindai Konflik"}</Button>}
            <Button variant="ghost" size="sm" onClick={load} disabled={loading}><RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Muat Ulang</Button>
          </div>
        )}
      />
      <PageBody>
        <div role="tablist" aria-label="Saring antrean QC" className="flex flex-wrap items-center gap-1 border-b border-line pb-2">
          {QC_TABS.map((t) => (
            <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => { setTab(t.key); setNotice(""); }}
              className={`rounded-chip px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${tab === t.key ? "bg-accentbg text-accent" : "text-ink3 hover:bg-hovertint hover:text-ink2"}`}>{t.label}</button>
          ))}
          {items && !kosong && <span className="ml-auto self-center text-[11.5px] text-ink3">{items.length} unit</span>}
        </div>

        {notice && <div className="rounded-btn bg-greenbg px-3 py-2.5 text-[12.5px] text-green">{notice}</div>}
        {error && <div role="alert" className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{error}</div>}

        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[1, 2, 3].map((n) => <Card key={n} className="h-40 animate-pulse bg-inset" />)}</div>
        ) : kosong ? (
          <Card className="overflow-hidden p-0"><EmptyState icon={ClipboardCheck} title={copy.title} description={copy.description} /></Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {merged.map(({ queue, view }) => {
              if (!view) return <QueueCard key={queue.runId} item={queue} onOpen={(i) => setSelectedRunId(i.runId)} />;
              const badge = qcStateBadgeFor(queue.state);
              return (
                <UnitCard key={queue.runId} view={view} today={today} tomorrow={tomorrow} showGaps={false} onOpen={(v) => setOverviewUnitId(v.unit.id)}
                  qcBadge={(
                    <div className="flex flex-wrap items-center gap-1.5" data-testid="qc-state">
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                      {queue.lastInspection && <span className="text-[11.5px] text-ink3">QC terakhir #{queue.lastInspection.version} · {inspectionBadgeFor(queue.lastInspection.result).label}</span>}
                      {queue.conflict && <span className="flex items-center gap-1 text-[11.5px] text-red"><AlertTriangle size={12} aria-hidden /> {conflictKindLabel(queue.conflict.kind)}</span>}
                    </div>
                  )}
                  footer={<Button size="sm" data-mutates className="min-h-[44px] w-full" onClick={() => setSelectedRunId(queue.runId)}><ClipboardCheck size={14} aria-hidden /> Putusan QC</Button>} />
              );
            })}
          </div>
        )}
      </PageBody>

      {overviewUnitId && (
        <UnitOverviewDrawer unitId={overviewUnitId} onClose={() => setOverviewUnitId(null)} manageLabel="Putusan QC"
          onManage={() => { const m = merged.find((x) => x.view?.unit?.id === overviewUnitId); setOverviewUnitId(null); if (m) setSelectedRunId(m.queue.runId); }} />
      )}
      {selectedRunId && <RunDetailModal runId={selectedRunId} onClose={() => { setSelectedRunId(null); load(); }} onChanged={load} />}
    </PageContainer>
  );
}
