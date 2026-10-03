import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronRight, Clock, Hammer, Loader2, PackageX, Scissors, X } from "lucide-react";
import { api } from "@/api.js";
import StandaloneShell from "@/components/StandaloneShell.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { ProgressBar } from "@/components/ui/progress.jsx";
import EvidenceCapture from "@/features/production/components/EvidenceCapture.jsx";
import StepForm from "@/features/production/components/StepForm.jsx";
import { DiagnosisWizard } from "@/features/production/DiagnosisWizard.jsx";
import { isGantiKain } from "@/features/production/unitCardModel.js";
import {
  MEDIA_RULES, STEP_BY_NO, actionLabel, bucketStyle, buildStepPayload, clearDraft, createIntentKeys, formatMinutes, friendlyError,
  isQuickAction, isRetryableError, loadDraft, saveDraft, validateStepForm, waitCopy,
} from "@/features/production/experience.js";

// Aplikasi PIC Table (tahap 1–9) dan PIC Corner (tahap 10–12) — mobile-first, satu kartu aktif, satu tindakan berikutnya.
// Server = otoritas urutan & izin; halaman ini menampilkan `next` dari server dan mengirim bukti. Tanpa UUID ke pekerja.
const intentKeys = createIntentKeys();
const storage = typeof window !== "undefined" ? window.localStorage : null;
const POLL_MS = 30_000;

function UnitHeader({ card }) {
  const style = bucketStyle(card.bucket);
  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[20px] font-bold leading-tight text-ink">{card.unit.unitCode}</p>
          <p className="truncate text-[14px] text-ink2">{card.customer.name || "Customer"}{card.plan?.stationLabel ? ` · ${card.plan.stationLabel}` : ""}</p>
        </div>
        <Badge variant={style.badge}>{style.label}</Badge>
      </div>
      <p className="text-[13px] text-ink3">{[card.unit.merk, card.unit.ukuran, card.unit.service?.label].filter(Boolean).join(" · ") || "Detail kasur belum dicatat"}</p>
      {/* P12B: PIC produksi harus melihat apa yang DIJUAL Sales; Ganti Kain krusial (kain harus sesuai permintaan customer). */}
      <p data-testid="layanan-sales" className="m-0 break-words text-[14px] font-semibold text-ink [overflow-wrap:anywhere]"><span className="font-medium text-ink3">Layanan Sales: </span>{card.customer.salesServices?.length ? card.customer.salesServices.join(" + ") : "belum dicatat Sales"}</p>
      {isGantiKain({ customer: card.customer }) && (
        <div data-testid="ganti-kain-note" role="note" className="rounded-btn border border-orange bg-orangebg px-3 py-2 text-[13.5px] font-bold text-orange">
          <p className="m-0 flex items-start gap-1.5"><Scissors size={15} className="mt-px shrink-0" aria-hidden /> Ganti Kain — pastikan sesuai permintaan customer</p>
          {!card.customer.request && <p className="m-0 mt-1 text-[13px] font-semibold">Catatan kain belum tersedia — konfirmasi ke Sales</p>}
        </div>
      )}
      <dl className="m-0 grid grid-cols-2 gap-2 text-[13px]">
        <div className="rounded-btn bg-inset px-3 py-2"><dt className="m-0 text-ink3">Berat badan</dt><dd className="m-0 font-semibold text-ink">{card.customer.weightKg ? `${card.customer.weightKg} kg` : "—"}</dd></div>
        <div className="rounded-btn bg-inset px-3 py-2"><dt className="m-0 text-ink3">Posisi tidur</dt><dd className="m-0 font-semibold text-ink">{card.customer.sleepPosition || "Belum dicatat Sales"}</dd></div>
        <div className="col-span-2 min-w-0 rounded-btn bg-inset px-3 py-2"><dt className="m-0 text-ink3">Keluhan</dt><dd className="m-0 break-words font-semibold text-ink">{card.customer.complaints?.length ? card.customer.complaints.join(", ") : "—"}</dd></div>
        {card.customer.request && <div data-testid="request-khusus" className="col-span-2 min-w-0 rounded-btn bg-inset px-3 py-2"><dt className="m-0 text-ink3">Request khusus</dt><dd className="m-0 break-words font-semibold text-ink [overflow-wrap:anywhere]">{card.customer.request}</dd></div>}
      </dl>
      <div>
        <div className="mb-1 flex justify-between text-[12.5px] text-ink3">
          <span>{card.progress.done} dari {card.progress.total} tahap</span>
          <span className="flex items-center gap-1"><Clock size={13} aria-hidden /> {formatMinutes(card.timer.elapsedMinutes)}{card.timer.late ? " · terlambat" : ""}</span>
        </div>
        <ProgressBar value={card.progress.total ? (card.progress.done / card.progress.total) * 100 : 0} variant={card.timer.late ? "danger" : "accent"} />
      </div>
    </div>
  );
}

function StepList({ steps, lane }) {
  const mine = steps.filter((s) => (lane === "CORNER" ? s.no >= 9 : s.no <= 9));
  return (
    <ol className="m-0 list-none p-0 space-y-1" aria-label="Tahap">
      {mine.map((s) => (
        <li key={s.no} className={`flex items-center gap-3 rounded-btn px-3 py-2 text-[13.5px] ${s.status === "CURRENT" ? "bg-accentbg font-semibold text-accent" : s.status === "NA" ? "text-ink3 line-through" : "text-ink2"}`}>
          <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${s.status === "DONE" ? "bg-green text-white" : s.status === "CURRENT" ? "bg-accent text-white" : "bg-inset text-ink3"}`}>
            {s.status === "DONE" ? <CheckCircle2 size={14} aria-hidden /> : s.no}
          </span>
          <span className="flex-1">{s.label}</span>
          {s.status === "NA" && <span className="text-[11px]">tidak berlaku</span>}
          {s.status === "WAITING" && <span className="text-[11px] text-orange">menunggu</span>}
        </li>
      ))}
    </ol>
  );
}

function EvidenceHistory({ evidence }) {
  if (!evidence?.length) return null;
  return (
    <section aria-label="Riwayat bukti" className="space-y-2">
      <h3 className="text-[13px] font-bold text-ink2">Riwayat bukti</h3>
      <ul className="m-0 list-none p-0 space-y-2">
        {[...evidence].reverse().slice(0, 8).map((e) => (
          <li key={e.id} className="rounded-btn bg-inset p-2">
            <p className="text-[12.5px] text-ink2"><b className="text-ink">{e.stepNo}. {e.stepLabel}</b>{e.version > 1 ? ` (ke-${e.version})` : ""}{e.payload?.verdict ? ` · ${e.payload.verdict.replace("_", " ")}` : ""}{e.actor ? ` · ${e.actor}` : ""}</p>
            {e.media?.length > 0 && (
              <div className="mt-1.5 flex gap-1.5 overflow-x-auto">
                {e.media.map((m) => (m.kind === "video"
                  ? <video key={m.url} src={m.url} controls preload="none" className="h-20 w-28 shrink-0 rounded object-cover" />
                  : <img key={m.url} src={m.url} alt="Bukti" loading="lazy" className="h-20 w-20 shrink-0 rounded object-cover" />))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

// P9D — tahap 5 (Diagnosa) pakai wizard KHUSUS (DiagnosisWizard), bukan StepForm generik: submit-nya menulis
// Planned BOM + layanan teknis lewat command TERPISAH (submitDiagnosis), baru KEMUDIAN menutup tahap lewat
// recordProductionV2Step yang SAMA persis dipakai tahap lain (payload ringkas dari kesimpulan diagnosa) —
// mengulang findings terstruktur sebagai `diagnosis` teks supaya validateStepEvidence (kontrak lama, TIDAK
// diubah) tetap terpenuhi. TIDAK membuka halaman baru — tetap StepSheet layar-penuh yang sama.
function DiagnosisStepSheet({ card, next, onClose, onSubmitted }) {
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
    // Diagnosis (BOM + layanan teknis) sudah tersimpan server. Tutup tahap 5 lewat jalur SAMA dengan tahap
    // lain — kalau gagal (mis. revisi run basi), diagnosis TETAP tersimpan (tidak hilang), operator tinggal
    // buka lagi tahap 5 untuk "Lanjutkan" (pola reuseDiagnosis yang sudah ada di recordProductionStep).
    try {
      const closeResult = await api.recordProductionV2Step(card.runId, 5, {
        expectedRevision: card.revision, workCenterId: card.workCenterId,
        payload: { diagnosis: result.serviceLabel ? `Layanan teknis: ${result.serviceLabel}` : "Diagnosis dikirim", inputMethod: "TEXT" }, media: [],
      }, intentKeys.keyFor(card.runId, 5, card.revision));
      intentKeys.release(card.runId, 5, card.revision);
      onSubmitted(closeResult);
    } catch (e) {
      setCloseError(friendlyError(e));
      onSubmitted(null); // muat ulang kartu — diagnosis sudah tersimpan, status terbaru akan terlihat
    }
  }

  return (
    <DiagnosisWizard
      card={{
        runId: card.runId, unitCode: card.unit.unitCode, workCenterId: card.workCenterId,
        customer: card.customer, priorServiceLabel: card.unit.service?.label ?? null,
        diagnosisRevision: diagState.current?.revision ?? 0, current: diagState.current,
      }}
      onClose={onClose}
      onSubmitted={handleSubmitted}
    />
  );
}

// Lembar isian tahap (layar penuh di HP). Draft form + bukti terunggah disimpan lokal otomatis.
function StepSheet({ card, next, onClose, onSubmitted }) {
  const stepNo = next.stepNo;
  if (stepNo === 5) return <DiagnosisStepSheet card={card} next={next} onClose={onClose} onSubmitted={onSubmitted} />;
  const step = STEP_BY_NO[stepNo];
  const draft = useMemo(() => loadDraft(storage, card.runId, stepNo), [card.runId, stepNo]);
  const [form, setForm] = useState(() => draft?.form || {});
  const [media, setMedia] = useState(() => (draft?.media || []).filter((m) => m.status === "done"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [canRetry, setCanRetry] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => saveDraft(storage, card.runId, stepNo, { form, media: media.filter((m) => m.status === "done").map(({ id, kind, url, previewUrl }) => ({ id, kind, url, previewUrl, status: "done" })) }), 400);
    return () => clearTimeout(t);
  }, [form, media, card.runId, stepNo]);

  async function submit() {
    const invalid = validateStepForm(stepNo, form, { mediaItems: media });
    if (invalid) { setError(invalid); return; }
    setBusy(true); setError(""); setCanRetry(false);
    const key = intentKeys.keyFor(card.runId, stepNo, card.revision);
    try {
      const result = await api.recordProductionV2Step(card.runId, stepNo, {
        expectedRevision: card.revision, workCenterId: card.workCenterId,
        payload: buildStepPayload(stepNo, form), media: media.filter((m) => m.status === "done").map((m) => m.url),
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

  return (
    <div role="dialog" aria-modal="true" aria-label={step?.label} className="fixed inset-0 z-50 flex flex-col bg-base">
      <div className="flex items-center gap-2 border-b border-line bg-surface px-3 py-2" style={{ paddingTop: "calc(0.5rem + env(safe-area-inset-top))" }}>
        <button type="button" onClick={onClose} aria-label="Tutup" className="flex h-11 w-11 items-center justify-center rounded-btn text-ink2 hover:bg-hovertint"><X size={20} aria-hidden /></button>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] text-ink3">Tahap {stepNo} · {card.unit.unitCode}</p>
          <p className="truncate text-[16px] font-bold text-ink">{step?.label}{next.rework ? " (Rework)" : ""}</p>
        </div>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto px-3 py-4">
        <p className="rounded-btn bg-accentbg px-3 py-2 text-[13.5px] text-accent">{step?.hint}</p>
        {draft?.savedAt && <p className="text-[12px] text-ink3">Draft terakhir dipulihkan.</p>}
        <StepForm stepNo={stepNo} form={form} setForm={setForm} card={card} next={next} />
        {(MEDIA_RULES[stepNo]?.min > 0 || stepNo === 5 || stepNo === 10) && (
          <EvidenceCapture runId={card.runId} items={media} onChange={setMedia} rule={MEDIA_RULES[stepNo]} disabled={busy} />
        )}
        {error && <div role="alert" className="rounded-btn bg-redbg px-3 py-3 text-[13.5px] text-red">{error}</div>}
      </div>
      <div className="border-t border-line bg-surface px-3 pt-3" style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}>
        <button type="button" data-mutates onClick={submit} disabled={busy}
          className="flex min-h-[56px] w-full items-center justify-center gap-2 rounded-btn bg-accent text-[16px] font-bold text-white disabled:opacity-50">
          {busy ? <><Loader2 size={20} className="animate-spin" aria-hidden /> Mengirim…</> : canRetry ? "Coba Lagi" : actionLabel(next, { stageLabel: card.activeOp?.stageLabel })}
        </button>
      </div>
    </div>
  );
}

function ShortageSheet({ card, onClose, onDone }) {
  const [materials, setMaterials] = useState([]);
  const [picked, setPicked] = useState({});
  const [note, setNote] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    api.getMaterials({ active: "true" }).then((d) => setMaterials(Array.isArray(d) ? d : d?.items || [])).catch(() => setMaterials([]));
  }, []);
  const bomFirst = useMemo(() => {
    const bomIds = new Set((card.bom || []).map((b) => b.materialId));
    const fromBom = (card.bom || []).map((b) => ({ id: b.materialId, name: b.name, code: b.code }));
    const q = query.trim().toLowerCase();
    const all = [...fromBom, ...materials.filter((m) => !bomIds.has(m.id))];
    return q ? all.filter((m) => `${m.name} ${m.code}`.toLowerCase().includes(q)) : all;
  }, [card.bom, materials, query]);
  const items = Object.entries(picked).filter(([, v]) => v.on).map(([materialId, v]) => ({ materialId, qty: v.qty ? Number(String(v.qty).replace(",", ".")) : undefined }));

  async function submit() {
    if (!items.length) { setError("Pilih bahan yang kurang."); return; }
    setBusy(true); setError("");
    try {
      await api.reportProductionV2Shortage(card.runId, { expectedRevision: card.revision, workCenterId: card.workCenterId, items, note: note.trim() || undefined });
      onDone();
    } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  }
  return (
    <div role="dialog" aria-modal="true" aria-label="Menunggu Bahan Baku" className="fixed inset-0 z-50 flex flex-col bg-base">
      <div className="flex items-center gap-2 border-b border-line bg-surface px-3 py-2" style={{ paddingTop: "calc(0.5rem + env(safe-area-inset-top))" }}>
        <button type="button" onClick={onClose} aria-label="Tutup" className="flex h-11 w-11 items-center justify-center rounded-btn text-ink2 hover:bg-hovertint"><X size={20} aria-hidden /></button>
        <p className="flex-1 text-[16px] font-bold text-ink">Menunggu Bahan Baku</p>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-4">
        <p className="rounded-btn bg-orangebg px-3 py-2 text-[13.5px] text-orange">Pekerjaan dijeda dan Gudang langsung melihat daftar ini. Lanjutkan setelah bahan diserahkan.</p>
        <input aria-label="Cari bahan" className="block w-full rounded-btn border border-line bg-surface px-3 py-3 text-[15px] text-ink" placeholder="Cari bahan…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <ul className="m-0 list-none p-0 space-y-2">
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
      <div className="border-t border-line bg-surface px-3 pt-3" style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}>
        <button type="button" data-mutates onClick={submit} disabled={busy} className="flex min-h-[56px] w-full items-center justify-center gap-2 rounded-btn bg-red text-[16px] font-bold text-white disabled:opacity-50">
          {busy ? "Mengirim…" : `Kirim ke Gudang (${items.length} bahan)`}
        </button>
      </div>
    </div>
  );
}

export default function WorkerLane({ lane = "TABLE" }) {
  const laneKey = lane === "CORNER" ? "corner" : "table";
  const [queue, setQueue] = useState(null);
  const [readerMode, setReaderMode] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [card, setCard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [sheet, setSheet] = useState(null); // "step" | "shortage"
  const [quickBusy, setQuickBusy] = useState(false);
  const selectedRef = useRef(null);
  selectedRef.current = selectedId;

  const loadQueue = useCallback(async () => {
    try {
      const d = await api.getProductionV2WorkerQueue(laneKey);
      setQueue(d.items || []); setReaderMode(d.readerMode); setError("");
      if (!selectedRef.current && d.items?.length === 1) setSelectedId(d.items[0].runId);
    } catch (e) { setError(friendlyError(e)); } finally { setLoading(false); }
  }, [laneKey]);
  const loadCard = useCallback(async (runId = selectedRef.current) => {
    if (!runId) { setCard(null); return; }
    try { setCard(await api.getProductionV2Card(runId)); } catch (e) { setError(friendlyError(e)); }
  }, []);

  useEffect(() => { loadQueue(); }, [loadQueue]);
  useEffect(() => { if (!notice) return undefined; const t = setTimeout(() => setNotice(""), 4000); return () => clearTimeout(t); }, [notice]);
  useEffect(() => { loadCard(selectedId); }, [selectedId, loadCard]);
  useEffect(() => {
    const tick = () => { if (document.visibilityState === "visible" && !sheet) { loadQueue(); loadCard(); } };
    const id = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", tick); };
  }, [loadQueue, loadCard, sheet]);

  const refresh = () => { setLoading(true); loadQueue(); loadCard(); };
  const next = card?.next;
  const mineNow = next && next.action !== "WAIT" && (lane === "CORNER" ? next.actor === "CORNER" : next.actor === "TABLE");

  async function quick() {
    setQuickBusy(true); setError("");
    const key = intentKeys.keyFor(card.runId, next.stepNo, card.revision);
    try {
      await api.recordProductionV2Step(card.runId, next.stepNo, { expectedRevision: card.revision, workCenterId: card.workCenterId, payload: {}, media: [] }, key);
      intentKeys.release(card.runId, next.stepNo, card.revision);
      setNotice("Tersimpan."); await loadCard(); loadQueue();
    } catch (e) {
      if (!isRetryableError(e)) intentKeys.release(card.runId, next.stepNo, card.revision);
      setError(friendlyError(e)); loadCard();
    } finally { setQuickBusy(false); }
  }

  const title = lane === "CORNER" ? "Meja Corner" : "Meja Bongkar";
  const Icon = lane === "CORNER" ? Scissors : Hammer;

  return (
    <StandaloneShell title={title} subtitle={card ? card.unit.unitCode : `${queue?.length ?? 0} unit di antrean`} onRefresh={refresh} refreshing={loading}>
      {notice && <div role="status" className="mb-3 rounded-btn bg-greenbg px-3 py-3 text-[13.5px] font-semibold text-green">{notice}</div>}
      {error && <div role="alert" className="mb-3 rounded-btn bg-redbg px-3 py-3 text-[13.5px] text-red">{error}</div>}

      {loading && !queue ? (
        <div className="space-y-3">{[1, 2, 3].map((n) => <div key={n} className="h-24 animate-pulse rounded-card bg-inset" />)}</div>
      ) : readerMode === "OFF" ? (
        <div className="rounded-card bg-surface p-6 text-center"><Icon className="mx-auto mb-2 text-ink3" size={32} aria-hidden /><p className="font-semibold text-ink">Produksi V2 belum aktif</p><p className="mt-1 text-[13.5px] text-ink3">Gunakan alur Work Order lama sampai Production Lead mengaktifkan V2.</p></div>
      ) : !card ? (
        queue?.length ? (
          <ul className="m-0 list-none p-0 space-y-2">
            {queue.map((item) => {
              const st = bucketStyle(item.bucket);
              return (
                <li key={item.runId}>
                  <button type="button" data-testid="worker-unit-card" data-unit-code={item.unit.unitCode} onClick={() => setSelectedId(item.runId)} className="flex w-full items-center gap-3 rounded-card bg-surface p-4 text-left shadow-sm active:scale-[0.99]">
                    <span className={`h-10 w-1.5 shrink-0 rounded-full ${st.dot}`} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[16px] font-bold text-ink">{item.unit.unitCode}</span>
                      <span className="block truncate text-[13px] text-ink3">{item.customer.name} · {item.next?.stepNo ? `Tahap ${item.next.stepNo}: ${STEP_BY_NO[item.next.stepNo]?.label}` : st.label}</span>
                    </span>
                    {item.plan?.priority > 0 && <Badge variant={item.plan.priority === 2 ? "red" : "orange"}>{item.plan.priorityLabel}</Badge>}
                    <ChevronRight size={18} className="text-ink3" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="rounded-card bg-surface p-6 text-center"><CheckCircle2 className="mx-auto mb-2 text-green" size={32} aria-hidden /><p className="font-semibold text-ink">Tidak ada unit untuk Anda</p><p className="mt-1 text-[13.5px] text-ink3">Unit muncul di sini setelah Planner menugaskannya ke Anda.</p></div>
        )
      ) : (
        <div className="space-y-4" data-testid="worker-unit-detail" data-unit-code={card.unit?.unitCode}>
          {queue?.length > 1 && <button type="button" onClick={() => { setSelectedId(null); setCard(null); }} className="min-h-[44px] text-[13.5px] font-semibold text-accent">← Semua unit ({queue.length})</button>}
          <div className="rounded-card bg-surface p-4 shadow-sm"><UnitHeader card={card} /></div>

          {mineNow ? (
            <div className="space-y-2">
              <p className="text-[13px] text-ink3">Tindakan berikutnya · Tahap {next.stepNo}</p>
              {next.rework && <p className="rounded-btn bg-orangebg px-3 py-2 text-[13.5px] text-orange">Uji tekstur {String(next.lastVerdict || "").replace("_", " ").toLowerCase()} — sesuaikan lapisan lalu kirim ulang bukti.</p>}
              <button type="button" data-testid={next.stepNo === 5 ? "open-diagnosis" : undefined} data-mutates={isQuickAction(next) ? "" : undefined} disabled={quickBusy} onClick={() => (isQuickAction(next) ? quick() : setSheet("step"))}
                className="flex min-h-[64px] w-full items-center justify-center gap-2 rounded-btn bg-accent px-4 text-[17px] font-bold text-white shadow-sm active:scale-[0.99] disabled:opacity-50">
                {quickBusy ? <Loader2 size={20} className="animate-spin" aria-hidden /> : null}
                {actionLabel(next, { stageLabel: card.activeOp?.stageLabel })}
              </button>
            </div>
          ) : (
            <div className="rounded-card bg-surface p-4">
              <p className="text-[15px] font-bold text-ink">{next?.action === "WAIT" ? waitCopy(next).title : "Tahap berikutnya milik tim lain"}</p>
              <p className="mt-1 text-[13.5px] text-ink3">{next?.action === "WAIT" ? waitCopy(next).text : lane === "CORNER" ? "Unit masih dikerjakan di meja bongkar." : "Unit sedang di meja Corner."}</p>
              {card.shortage && <ul className="m-0 list-none p-0 mt-2 list-disc pl-5 text-[13px] text-ink2">{card.shortage.items.map((i) => <li key={i.materialId}>{i.name}{i.qty ? ` — ${i.qty}` : ""}</li>)}</ul>}
            </div>
          )}

          {lane === "TABLE" && !card.shortage && next?.stepNo && next.stepNo >= 3 && next.stepNo <= 8 && (next.action !== "WAIT" || next.wait === "MATERIAL_NOT_READY") && (
            <button type="button" onClick={() => setSheet("shortage")} className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-btn bg-redbg text-[15px] font-bold text-red">
              <PackageX size={19} aria-hidden /> Menunggu Bahan Baku
            </button>
          )}
          {card.warnings?.filter((w) => w.code === "TERLAMBAT").map((w) => (
            <p key={w.code} className="flex items-center gap-2 rounded-btn bg-orangebg px-3 py-2 text-[13px] text-orange"><AlertTriangle size={15} aria-hidden /> {w.text}</p>
          ))}

          <details className="rounded-card bg-surface p-3" open>
            <summary className="min-h-[44px] cursor-pointer py-2 text-[14px] font-bold text-ink">Tahap</summary>
            <StepList steps={card.steps} lane={lane} />
          </details>
          <EvidenceHistory evidence={card.evidence} />
        </div>
      )}

      {sheet === "step" && card && next && (
        <StepSheet card={card} next={next} onClose={() => setSheet(null)}
          onSubmitted={async (result) => {
            if (result) { setSheet(null); setNotice(result.verdict && result.verdict !== "PAS" ? "Hasil uji tercatat — lanjutkan rework lapisan." : "Tahap tersimpan."); }
            await loadCard(); loadQueue();
          }} />
      )}
      {sheet === "shortage" && card && (
        <ShortageSheet card={card} onClose={() => setSheet(null)} onDone={async () => { setSheet(null); setNotice("Gudang sudah diberi tahu."); await loadCard(); loadQueue(); }} />
      )}
    </StandaloneShell>
  );
}
