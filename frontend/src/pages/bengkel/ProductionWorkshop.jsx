import React, { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Hammer, Loader2, Pause, Play, RefreshCw, SquareCheckBig } from "lucide-react";
import { api } from "@/api.js";
import { compressImage } from "@/utils/compressImage.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import {
  PAUSE_REASONS, QUEUE_SCOPES, STAGE_STATUS_LABEL, availableActions, currentStageOf, emptyStateCopy, historyActionLabel,
  nextStageOf, runStateBadgeFor, stageProgress, startBlockedReason, validateCompleteForm, validatePauseForm, workshopErrorMessage,
} from "@/features/production/workshopExecution.js";

// Antrean Kerja Workshop (Production Workshop + Warehouse V2, P5) — mulai, jeda, lanjutkan, dan selesai tahap di atas
// stage engine Production yang sudah ada. Produksi hanya bisa dimulai setelah bahan diserahkan Gudang (P4). Menyelesaikan
// tahap workshop TERAKHIR hanya membawa unit ke "Menunggu QC" — hasil QC dan siap kirim bukan bagian layar ini.
// Data hanya muncul bila reader V2 (production_v2_reader) diaktifkan server untuk cohort unit terkait (fail-closed,
// bukan error). Halaman ini TIDAK mengaktifkan/mengubah flag apa pun. Logika murni: features/production/workshopExecution.js.

const waktu = (s) => (s ? new Date(s).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

function QueueCard({ item, onOpen }) {
  const badge = runStateBadgeFor(item.state);
  return (
    <Card className="flex cursor-pointer flex-col gap-3 p-4 hover:bg-hovertint" onClick={() => onOpen(item)}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[13px] font-bold text-ink">{item.unit.unitCode}</p>
          <p className="text-[12px] text-ink3">{item.unit.orderNumber ? `Order ${item.unit.orderNumber}` : "Tanpa nomor order"}</p>
        </div>
        <Badge variant={badge.variant}>{badge.label}</Badge>
      </div>
      <dl className="space-y-1 text-[12px]">
        <div className="flex justify-between"><dt className="text-ink3">Workshop</dt><dd className="text-ink">{item.workCenter?.name || "—"}</dd></div>
        <div className="flex justify-between"><dt className="text-ink3">Operator</dt><dd className="text-ink">{item.operator?.name || "—"}</dd></div>
        <div className="flex justify-between"><dt className="text-ink3">Target Mulai</dt><dd className="text-ink">{waktu(item.targetStartAt)}</dd></div>
        <div className="flex justify-between"><dt className="text-ink3">Tahap</dt><dd className="text-ink">{item.currentStage?.label || `${item.completedStages} selesai`}</dd></div>
      </dl>
    </Card>
  );
}

function PhotoPicker({ unitId, photos, onChange, disabled, onError, required }) {
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
        {photos.length > 0 ? `${photos.length} foto siap` : "Ambil / Pilih Foto"}
        <input type="file" accept="image/*" capture="environment" multiple hidden onChange={handle} disabled={disabled || uploading} />
      </label>
      {photos.length > 0 && <div className="flex flex-wrap gap-2">{photos.map((u) => <img key={u} src={u} alt="Foto bukti" className="h-12 w-12 rounded object-cover" />)}</div>}
      {required && photos.length === 0 && <p className="text-[11px] text-orange">Tahap ini wajib foto</p>}
    </div>
  );
}

function RunDetailModal({ runId, onClose, onChanged }) {
  const [run, setRun] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [mode, setMode] = useState(null); // null | "pause" | "complete"
  const [pauseReason, setPauseReason] = useState("BREAK");
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState([]);
  // Satu kunci idempotensi per NIAT perintah: dipakai ulang bila pengguna mengulang setelah galat jaringan, diganti setelah sukses.
  const keyRef = useRef({});

  const load = useCallback(() => {
    setLoading(true);
    return api.getWorkshopRun(runId)
      .then((d) => setRun(d))
      .catch((e) => setError(e.message || "Gagal memuat detail"))
      .finally(() => setLoading(false));
  }, [runId]);
  useEffect(() => { load(); }, [load]);

  const keyFor = (action) => {
    if (!keyRef.current[action]) keyRef.current[action] = `web-workshop-${action}-${crypto.randomUUID()}`;
    return keyRef.current[action];
  };

  const execute = async (action, body, successMessage) => {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await api.workshopCommand(runId, action, { expectedRevision: run.revision, workCenterId: run.plan?.workCenter?.id, ...body }, keyFor(action));
      delete keyRef.current[action];
      setNotice(result.replayed ? "Perintah ini sudah diproses sebelumnya." : successMessage(result));
      setMode(null); setNote(""); setPhotos([]);
      await load();
      onChanged();
    } catch (e) {
      // 409 revisi basi: muat ulang supaya pengguna melihat kondisi terbaru; kunci baru untuk percobaan berikutnya.
      if (e.status === 409 || e.status === 400 || e.status === 403 || e.status === 422) delete keyRef.current[action];
      setError(workshopErrorMessage(e));
      if (e.code === "WORKSHOP_REVISION_CONFLICT") await load();
    } finally { setBusy(false); }
  };

  const actions = availableActions(run);
  const stage = currentStageOf(run);
  const next = nextStageOf(run);
  const progress = stageProgress(run);
  const blocked = startBlockedReason(run);
  const badge = runStateBadgeFor(run?.state);

  const submitPause = () => {
    const check = validatePauseForm({ reason: pauseReason, note });
    if (!check.valid) { setError(check.error); return; }
    execute("pause", { reason: pauseReason, note: note.trim() || undefined, photoUrls: photos }, () => "Tahap dijeda.");
  };
  const submitComplete = () => {
    const check = validateCompleteForm({ stage, photoUrls: photos });
    if (!check.valid) { setError(check.error); return; }
    execute("complete", { note: note.trim() || undefined, photoUrls: photos }, (r) => (r.awaitingQc ? "Seluruh tahap workshop selesai — unit menunggu QC." : "Tahap diselesaikan."));
  };

  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title={run ? `Detail Tahap ${run.unit.unitCode}` : "Detail Tahap"} description="Mulai, jeda, lanjutkan, dan selesaikan tahap workshop untuk unit ini.">
      <div className="space-y-3">
        {notice && <div className="rounded-btn bg-greenbg px-3 py-2 text-[12.5px] text-green">{notice}</div>}
        {error && <div role="alert" className="rounded-btn bg-redbg px-3 py-2 text-[12.5px] text-red">{error}</div>}
        {loading && !run ? <div className="h-32 animate-pulse rounded-card bg-inset" /> : !run ? null : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={badge.variant}>{badge.label}</Badge>
              <span className="text-[12px] text-ink3">{progress.done}/{progress.total} tahap selesai</span>
              {run.origin === "WORKSHOP_BORN" && <Badge variant="accent">Lahir di Workshop</Badge>}
            </div>
            {run.pathError && <div className="rounded-btn bg-orangebg px-3 py-2 text-[12.5px] text-orange">{run.pathError}</div>}
            {blocked && <div className="rounded-btn bg-orangebg px-3 py-2 text-[12.5px] text-orange">{blocked}</div>}

            <section aria-label="Tahap produksi">
              <h3 className="mb-1 text-[12.5px] font-bold text-ink">Tahap Produksi</h3>
              <ol className="divide-y divide-line rounded-card border border-line">
                {run.stages.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 px-3 py-2 text-[12.5px]">
                    <span className="text-ink">{s.order}. {s.label}{s.requiresPhoto ? " · wajib foto" : ""}{!s.required ? " · opsional" : ""}</span>
                    <Badge variant={s.status === "COMPLETED" ? "success" : s.status === "ACTIVE" ? "info" : s.status === "PAUSED" ? "warning" : "neutral"}>{STAGE_STATUS_LABEL[s.status] || s.status}</Badge>
                  </li>
                ))}
              </ol>
              {run.qcGate && <p className="mt-1 text-[11.5px] text-ink3">Setelah tahap terakhir: {run.qcGate.label} (QC) — diputuskan oleh petugas QC, bukan di layar ini.</p>}
            </section>

            {mode === "pause" && (
              <section aria-label="Form jeda" className="space-y-2 rounded-card border border-line p-3">
                <h3 className="text-[12.5px] font-bold text-ink">Jeda Tahap</h3>
                <label className="block text-[12px] text-ink3">Alasan jeda
                  <select className="mt-1 w-full rounded-btn border border-line bg-transparent px-2 py-2 text-[13px] text-ink" value={pauseReason} onChange={(e) => setPauseReason(e.target.value)}>
                    {PAUSE_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </label>
                <label className="block text-[12px] text-ink3">Catatan{pauseReason === "OTHER" ? " (wajib)" : " (opsional)"}
                  <textarea className="mt-1 w-full rounded-btn border border-line bg-transparent px-2 py-2 text-[13px] text-ink" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
                </label>
                <PhotoPicker unitId={run.unit.id} photos={photos} onChange={setPhotos} disabled={busy} onError={setError} />
                <div className="flex gap-2">
                  <Button size="sm" onClick={submitPause} disabled={busy}><Pause size={14} /> {busy ? "Menjeda…" : "Jeda Tahap"}</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setMode(null); setError(""); }} disabled={busy}>Batal</Button>
                </div>
              </section>
            )}

            {mode === "complete" && (
              <section aria-label="Form selesai tahap" className="space-y-2 rounded-card border border-line p-3">
                <h3 className="text-[12.5px] font-bold text-ink">Selesai Tahap {stage?.label}</h3>
                <label className="block text-[12px] text-ink3">Catatan (opsional)
                  <textarea className="mt-1 w-full rounded-btn border border-line bg-transparent px-2 py-2 text-[13px] text-ink" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
                </label>
                <PhotoPicker unitId={run.unit.id} photos={photos} onChange={setPhotos} disabled={busy} onError={setError} required={!!stage?.requiresPhoto} />
                <div className="flex gap-2">
                  <Button size="sm" onClick={submitComplete} disabled={busy}><SquareCheckBig size={14} /> {busy ? "Menyimpan…" : "Selesai Tahap"}</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setMode(null); setError(""); }} disabled={busy}>Batal</Button>
                </div>
              </section>
            )}

            {!mode && (
              <div className="flex flex-wrap gap-2">
                {actions.start && (
                  <Button size="sm" disabled={busy || !next} onClick={() => execute("start", {}, (r) => `Tahap ${r.stage?.label || ""} dimulai.`)}>
                    <Play size={14} /> {busy ? "Memulai…" : `Mulai${next ? ` ${next.label}` : ""}`}
                  </Button>
                )}
                {actions.resume && <Button size="sm" disabled={busy} onClick={() => execute("resume", {}, () => "Tahap dilanjutkan.")}><Play size={14} /> Lanjutkan</Button>}
                {actions.pause && <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setMode("pause"); setError(""); }}><Pause size={14} /> Jeda</Button>}
                {actions.complete && <Button size="sm" disabled={busy} onClick={() => { setMode("complete"); setError(""); }}><SquareCheckBig size={14} /> Selesai Tahap</Button>}
              </div>
            )}

            <section aria-label="Histori aktivitas">
              <h3 className="mb-1 text-[12.5px] font-bold text-ink">Histori Aktivitas</h3>
              {run.history.length === 0 ? (
                <p className="text-[12px] text-ink3">Belum ada aktivitas.</p>
              ) : (
                <ul className="space-y-1">
                  {run.history.map((h) => (
                    <li key={h.id} className="rounded-btn bg-inset px-3 py-2 text-[12px] text-ink2">
                      <span className="font-semibold text-ink">{historyActionLabel(h.action)}</span> · {h.stage} · {waktu(h.at)}{h.actor ? ` · ${h.actor}` : ""}
                      {h.pauseReason ? ` · ${PAUSE_REASONS.find((r) => r.value === h.pauseReason)?.label || h.pauseReason}` : ""}
                      {h.note ? ` — ${h.note}` : ""}
                      {h.photoUrls?.length > 0 && <span className="ml-1 text-ink3">({h.photoUrls.length} foto)</span>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </Modal>
  );
}

export default function ProductionWorkshop() {
  const [scope, setScope] = useState("today");
  const [mine, setMine] = useState(false);
  const [items, setItems] = useState(null);
  const [readerMode, setReaderMode] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedRunId, setSelectedRunId] = useState(null);

  const load = useCallback(() => {
    setLoading(true); setError("");
    api.getWorkshopQueue({ scope, mine: mine ? "1" : "" })
      .then((d) => { setItems(d.items || []); setReaderMode(d.readerMode || null); })
      .catch((e) => setError(e.message || "Gagal memuat antrean kerja"))
      .finally(() => setLoading(false));
  }, [scope, mine]);
  useEffect(() => { load(); }, [load]);

  const kosong = !loading && items && items.length === 0;
  const emptyCopy = emptyStateCopy({ readerMode, scope });

  return (
    <PageContainer>
      <PageHeader
        title="Antrean Kerja Workshop"
        subtitle="Unit yang bahannya sudah diserahkan Gudang: mulai, jeda, lanjutkan, dan selesaikan tahap."
        actions={<Button variant="ghost" size="sm" onClick={load} disabled={loading}><RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Muat Ulang</Button>}
      />
      <PageBody>
        <div role="tablist" aria-label="Saring antrean kerja" className="flex flex-wrap items-center gap-1 border-b border-line pb-2">
          {QUEUE_SCOPES.map((t) => (
            <button key={t.key} role="tab" aria-selected={scope === t.key} onClick={() => setScope(t.key)}
              className={`rounded-chip px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${scope === t.key ? "bg-accentbg text-accent" : "text-ink3 hover:bg-hovertint hover:text-ink2"}`}>
              {t.label}
            </button>
          ))}
          <label className="ml-2 flex items-center gap-1.5 text-[12.5px] text-ink2">
            <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Hanya milik saya
          </label>
          {items && !kosong && <span className="ml-auto self-center text-[11.5px] text-ink3">{items.length} unit</span>}
        </div>

        {error && <div role="alert" className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{error}</div>}

        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[1, 2, 3].map((n) => <Card key={n} className="h-40 animate-pulse bg-inset" />)}</div>
        ) : kosong ? (
          <Card className="overflow-hidden p-0"><EmptyState icon={Hammer} title={emptyCopy.title} description={emptyCopy.description} /></Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(items || []).map((item) => <QueueCard key={item.runId} item={item} onOpen={(i) => setSelectedRunId(i.runId)} />)}
          </div>
        )}
      </PageBody>

      {selectedRunId && <RunDetailModal runId={selectedRunId} onClose={() => { setSelectedRunId(null); load(); }} onChanged={load} />}
    </PageContainer>
  );
}
