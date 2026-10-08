import React, { useEffect, useMemo, useState } from "react";
import { Loader2, WifiOff, X } from "lucide-react";
import { api } from "@/api.js";
import { useOnline } from "@/components/StandaloneShell.jsx";
import EvidenceCapture from "@/features/production/components/EvidenceCapture.jsx";
import StepForm from "@/features/production/components/StepForm.jsx";
import { DiagnosisWizard } from "@/features/production/DiagnosisWizard.jsx";
import {
  BUILD_STEP_KASUR_HINT, stepMaterialsByPic, mediaRuleFor, productFlowOf, stepOf, actionLabel, buildStepPayload, clearDraft, createIntentKeys, friendlyError, isRetryableError, loadDraft, saveDraft, validateStepForm,
} from "@/features/production/experience.js";
import { submitState } from "./workerAppModel.js";
import { DELAY_ACTION_LABEL, DELAY_QUESTION, DELAY_REASONS, delayStatusText } from "@/features/production/productionLabels.js";

// Lembar isian layar-penuh Aplikasi Meja/Corner (diekstrak dari WorkerLane lama; kontrak server TIDAK berubah):
//  - tahap 5 = DiagnosisWizard (command Diagnosis terpisah) lalu menutup tahap lewat recordProductionV2Step yang sama;
//  - tahap lain = StepForm + bukti foto/video wajib sesuai MEDIA_RULES; draf & bukti terunggah tersimpan lokal;
//  - Idempotency-Key per niat (createIntentKeys), expectedRevision dari kartu server, konflik -> muat ulang.
// Offline: tombol kirim NONAKTIF dengan penjelasan; tidak ada status "berhasil" sebelum server menerima (hanya draf lokal).
export const intentKeys = createIntentKeys();
const storage = typeof window !== "undefined" ? window.localStorage : null;

export function OfflineNote() {
  return (
    <p role="status" data-testid="offline-submit-note" className="m-0 flex items-start gap-2 rounded-btn bg-orangebg px-3 py-2 text-[12.5px] font-semibold text-orange">
      <WifiOff size={15} className="mt-px shrink-0" aria-hidden /> {submitState({ online: false, busy: false }).reason}
    </p>
  );
}

export function SheetHeader({ onClose, subtitle, title }) {
  return (
    <div className="flex items-center gap-2 border-b border-line bg-surface px-3 py-2" style={{ paddingTop: "calc(0.5rem + env(safe-area-inset-top))" }}>
      <button type="button" onClick={onClose} aria-label="Tutup" className="flex h-11 w-11 items-center justify-center rounded-btn text-ink2 hover:bg-hovertint"><X size={20} aria-hidden /></button>
      <div className="min-w-0 flex-1">
        {subtitle && <p className="m-0 truncate text-[12px] text-ink3">{subtitle}</p>}
        <p className="m-0 truncate text-[16px] font-bold text-ink">{title}</p>
      </div>
    </div>
  );
}

function DiagnosisStepSheet({ card, onClose, onSubmitted }) {
  const [diagState, setDiagState] = useState(null);
  const [closeError, setCloseError] = useState("");
  useEffect(() => { api.getProductionV2Diagnosis(card.runId).then(setDiagState).catch(() => setDiagState({ current: null })); }, [card.runId]);
  if (!diagState) return <div className="fixed inset-0 z-50 flex items-center justify-center bg-base"><Loader2 size={24} className="animate-spin text-accent" aria-hidden /></div>;
  if (closeError) {
    return (
      <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-base px-6 text-center">
        <p className="text-[15px] font-semibold text-ink">Diagnosis tersimpan, tapi tahap belum tertutup:</p>
        <p className="rounded-btn bg-redbg px-3 py-3 text-[13.5px] text-red">{closeError}</p>
        <p className="text-[13px] text-ink3">Buka tahap 5 lagi untuk melanjutkan — data diagnosis tidak hilang.</p>
        <button type="button" onClick={onClose} className="min-h-[48px] rounded-btn bg-accent px-6 text-[15px] font-bold text-white">Tutup</button>
      </div>
    );
  }
  async function handleSubmitted(result) {
    // Diagnosis (BOM + layanan teknis) sudah tersimpan server. Tutup tahap 5 lewat jalur SAMA dengan tahap lain; bila gagal diagnosis TETAP tersimpan.
    try {
      const closeResult = await api.recordProductionV2Step(card.runId, 5, {
        expectedRevision: card.revision, workCenterId: card.workCenterId,
        payload: { diagnosis: "Diagnosis dikirim", inputMethod: "TEXT" }, media: [],
      }, intentKeys.keyFor(card.runId, 5, card.revision));
      intentKeys.release(card.runId, 5, card.revision);
      onSubmitted(closeResult);
    } catch (e) {
      setCloseError(friendlyError(e));
      onSubmitted(null);
    }
  }
  return (
    <DiagnosisWizard
      card={{ runId: card.runId, unitCode: card.unit.unitCode, workCenterId: card.workCenterId, customer: card.customer, priorServiceLabel: card.unit.service?.label ?? null, diagnosisRevision: diagState.current?.revision ?? 0, current: diagState.current }}
      onClose={onClose} onSubmitted={handleSubmitted}
    />
  );
}

export function StepSheet({ card, next, onClose, onSubmitted }) {
  const stepNo = next.stepNo;
  if (stepNo === 5) return <DiagnosisStepSheet card={card} onClose={onClose} onSubmitted={onSubmitted} />;
  return <StepFormSheet card={card} next={next} stepNo={stepNo} onClose={onClose} onSubmitted={onSubmitted} />;
}

function StepFormSheet({ card, next, stepNo, onClose, onSubmitted }) {
  const online = useOnline();
  const step = stepOf(stepNo, card.track);
  const flow = productFlowOf(card) || "KASUR";
  const byPic = stepMaterialsByPic(card, stepNo);
  const rule = mediaRuleFor(stepNo, card.track);
  const stepHint = card.track === "BUILD" && stepNo === 6 && flow === "KASUR" && !byPic ? BUILD_STEP_KASUR_HINT
    : byPic && card.track !== "BUILD" ? (stepNo === 6 ? "Video uji fondasi baru. Pemakaian bahan sudah dicatat PIC Bahan — tidak perlu diisi lagi." : "Foto lapisan baru. Pemakaian bahan sudah dicatat PIC Bahan — tidak perlu diisi lagi.") : step?.hint; // Fase 3: LAYANAN dengan PIC Bahan
  const draft = useMemo(() => loadDraft(storage, card.runId, stepNo), [card.runId, stepNo]);
  const [form, setForm] = useState(() => draft?.form || {});
  const [media, setMedia] = useState(() => (draft?.media || []).filter((m) => m.status === "done"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [canRetry, setCanRetry] = useState(false);

  useEffect(() => { setError(""); setCanRetry(false); }, [form, media]); // galat lama (mis. "Lampirkan minimal 1 foto") tidak boleh bertahan setelah isian diperbaiki
  useEffect(() => {
    const t = setTimeout(() => saveDraft(storage, card.runId, stepNo, { form, media: media.filter((m) => m.status === "done").map(({ id, kind, url, previewUrl }) => ({ id, kind, url, previewUrl, status: "done" })) }), 400);
    return () => clearTimeout(t);
  }, [form, media, card.runId, stepNo]);

  async function submit() {
    const invalid = validateStepForm(stepNo, form, { mediaItems: media, track: card.track, flow, byPic, gated: !!next.gated, layersRequired: !!next.layersRequired });
    if (invalid) { setError(invalid); return; }
    setBusy(true); setError(""); setCanRetry(false);
    const key = intentKeys.keyFor(card.runId, stepNo, card.revision);
    try {
      const result = await api.recordProductionV2Step(card.runId, stepNo, {
        expectedRevision: card.revision, workCenterId: card.workCenterId,
        payload: buildStepPayload(stepNo, form, { track: card.track, flow, byPic }), media: media.filter((m) => m.status === "done").map((m) => m.url),
      }, key);
      intentKeys.release(card.runId, stepNo, card.revision);
      clearDraft(storage, card.runId, stepNo);
      onSubmitted(result);
    } catch (e) {
      if (isRetryableError(e)) setCanRetry(true);
      else intentKeys.release(card.runId, stepNo, card.revision);
      setError(friendlyError(e));
      if (e.code === "STEP_REVISION_CONFLICT" || e.code === "STEP_OUT_OF_ORDER" || String(e.code || "").startsWith("STEP_WAITING_")) onSubmitted(null);
    } finally { setBusy(false); }
  }
  const gate = submitState({ online, busy });
  return (
    <div role="dialog" aria-modal="true" aria-label={step?.label} className="fixed inset-0 z-50 flex flex-col bg-base">
      <SheetHeader onClose={onClose} subtitle={`Tahap ${stepNo} · ${card.unit.unitCode}`} title={`${step?.label}${next.rework ? " (Rework)" : ""}`} />
      <div className="flex-1 space-y-4 overflow-y-auto px-3 py-4">
        <p className="rounded-btn bg-accentbg px-3 py-2 text-[13.5px] text-accent">{stepHint}</p>
        {draft?.savedAt && <p className="text-[12px] text-ink3">Draft terakhir dipulihkan.</p>}
        <StepForm stepNo={stepNo} form={form} setForm={setForm} card={card} next={next} />
        {(rule.min > 0 || stepNo === 5 || stepNo === 10) && (
          <EvidenceCapture runId={card.runId} items={media} onChange={setMedia} rule={rule} disabled={busy || !online} />
        )}
        {error && <div role="alert" className="rounded-btn bg-redbg px-3 py-3 text-[13.5px] text-red">{error}</div>}
      </div>
      <div className="space-y-2 border-t border-line bg-surface px-3 pt-3" style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}>
        {!online && <OfflineNote />}
        <button type="button" data-mutates data-testid="step-submit" onClick={submit} disabled={gate.disabled}
          className="flex min-h-[56px] w-full items-center justify-center gap-2 rounded-btn bg-accent text-[16px] font-bold text-white disabled:opacity-50">
          {busy ? <><Loader2 size={20} className="animate-spin" aria-hidden /> Mengirim…</> : canRetry ? "Coba Lagi" : actionLabel(next, { stageLabel: card.activeOp?.stageLabel, track: card.track })}
        </button>
      </div>
    </div>
  );
}

export function ShortageSheet({ card, onClose, onDone }) {
  const online = useOnline();
  const [materials, setMaterials] = useState([]);
  const [picked, setPicked] = useState({});
  const [note, setNote] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { api.getMaterials({ active: "true" }).then((d) => setMaterials(Array.isArray(d) ? d : d?.items || [])).catch(() => setMaterials([])); }, []);
  const bomFirst = useMemo(() => {
    const bomIds = new Set((card.bom || []).map((b) => b.materialId));
    const fromBom = (card.bom || []).map((b) => ({ id: b.materialId, name: b.name, code: b.code }));
    const q = query.trim().toLowerCase();
    const all = [...fromBom, ...materials.filter((m) => !bomIds.has(m.id))];
    return q ? all.filter((m) => `${m.name} ${m.code}`.toLowerCase().includes(q)) : all;
  }, [card.bom, materials, query]);
  useEffect(() => { setError(""); }, [picked, note]);
  const items = Object.entries(picked).filter(([, v]) => v.on).map(([materialId, v]) => ({ materialId, qty: v.qty ? Number(String(v.qty).replace(",", ".")) : undefined }));

  async function submit() {
    if (!items.length) { setError("Pilih bahan yang kurang."); return; }
    setBusy(true); setError("");
    try {
      await api.reportProductionV2Shortage(card.runId, { expectedRevision: card.revision, workCenterId: card.workCenterId, items, note: note.trim() || undefined });
      onDone();
    } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  }
  const gate = submitState({ online, busy });
  return (
    <div role="dialog" aria-modal="true" aria-label={DELAY_ACTION_LABEL} className="fixed inset-0 z-50 flex flex-col bg-base">
      <SheetHeader onClose={onClose} subtitle={card.unit.unitCode} title={DELAY_ACTION_LABEL} />
      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-4">
        <div data-testid="delay-reason-block" className="space-y-1.5">
          <p className="m-0 text-[13.5px] font-semibold text-ink">{DELAY_QUESTION}</p>
          <p className="m-0"><span data-testid="delay-reason-chip" className="inline-flex min-h-[40px] items-center rounded-full bg-accentbg px-4 text-[14px] font-bold text-accent">{DELAY_REASONS.BAHAN.label}</span></p>
          <p className="m-0 text-[12.5px] text-ink3">Untuk pekerjaan di papan produksi, alasan yang tersedia hanya menunggu bahan. Alasan lain: hubungi Production Lead.</p>
        </div>
        <p className="rounded-btn bg-orangebg px-3 py-2 text-[13.5px] text-orange">Pekerjaan tampil sebagai “{delayStatusText("MATERIAL_SHORTAGE")}” dan Gudang langsung melihat daftar ini. Pekerjaan bisa dilanjutkan setelah Gudang menyerahkan bahan.</p>
        <input aria-label="Cari bahan" className="block w-full rounded-btn border border-line bg-surface px-3 py-3 text-[15px] text-ink" placeholder="Cari bahan…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <ul className="m-0 list-none space-y-2 p-0">
          {bomFirst.slice(0, 40).map((m) => {
            const v = picked[m.id] || {};
            return (
              <li key={m.id} className={`flex items-center gap-3 rounded-btn px-3 py-2 ${v.on ? "bg-accentbg" : "bg-inset"}`}>
                <button type="button" role="checkbox" aria-checked={!!v.on} onClick={() => setPicked((p) => ({ ...p, [m.id]: { ...v, on: !v.on } }))} className="flex min-h-[44px] flex-1 items-center text-left">
                  <span className="min-w-0"><span className="block truncate text-[14px] font-semibold text-ink">{m.name}</span><span className="text-[12px] text-ink3">{m.code}</span></span>
                </button>
                {v.on && <input aria-label={`Jumlah ${m.name}`} inputMode="decimal" placeholder="Qty" className="h-11 w-20 rounded-btn border border-line bg-surface text-center text-[15px] text-ink" value={v.qty || ""} onChange={(e) => setPicked((p) => ({ ...p, [m.id]: { ...v, qty: e.target.value } }))} />}
              </li>
            );
          })}
        </ul>
        <textarea aria-label="Catatan untuk Gudang" rows={2} className="block w-full rounded-btn border border-line bg-surface px-3 py-3 text-[15px] text-ink" placeholder="Catatan untuk Gudang (opsional)" value={note} onChange={(e) => setNote(e.target.value)} />
        {error && <div role="alert" className="rounded-btn bg-redbg px-3 py-3 text-[13.5px] text-red">{error}</div>}
      </div>
      <div className="space-y-2 border-t border-line bg-surface px-3 pt-3" style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}>
        {!online && <OfflineNote />}
        <button type="button" data-mutates onClick={submit} disabled={gate.disabled} className="flex min-h-[56px] w-full items-center justify-center gap-2 rounded-btn bg-red text-[16px] font-bold text-white disabled:opacity-50">
          {busy ? "Mengirim…" : `Kirim ke Gudang (${items.length} bahan)`}
        </button>
      </div>
    </div>
  );
}
