import React, { useCallback, useEffect, useRef, useState } from "react";
import { CloudOff, Loader2, Trash2, RotateCcw, Pencil, Play, X } from "lucide-react";
import { api } from "@/api.js";
import { useOnline } from "@/components/StandaloneShell.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import EvidenceCapture from "@/features/production/components/EvidenceCapture.jsx";
import { docFriendlyError, itemsForCorrection } from "@/features/production/documentation.js";
import {
  MAX_RETRY, STATUS, createDraftManager, createIdbAdapter, createMemoryAdapter, draftStatusLabel, makeThumbDataUrl,
} from "@/features/production/documentationDrafts.js";
import { compressImage } from "@/utils/compressImage.js";

// UI draf offline Aplikasi Dokumentasi (P10B): hook manager (IndexedDB), panel antrean kirim, dan sheet kamera yang bekerja DI ATAS draf
// persisten — foto langsung disimpan di HP, diunggah otomatis saat online, dan tetap ada setelah refresh/PWA tertutup.
const apiBridge = {
  upload: (runId, blob, onProgress) => api.uploadProductionV2Documentation(runId, [blob], onProgress),
  submit: (runId, body, key) => api.submitProductionV2Documentation(runId, body, key),
  correct: (runId, body, key) => api.correctProductionV2Documentation(runId, body, key),
};
const readPrincipal = () => { try { const u = JSON.parse(localStorage.getItem("user") || "null"); return u?.id ? String(u.id) : null; } catch { return null; } };
const isActive = (s) => !!s && s.queued + s.sending + s.uploading > 0;

export function useDraftManager() {
  const [manager, setManager] = useState(null);
  const [persistent, setPersistent] = useState(true);
  const [summary, setSummary] = useState(null);
  const [records, setRecords] = useState([]);
  const [stats, setStats] = useState(null);
  const [lastSent, setLastSent] = useState(null);
  const online = useOnline();
  const statsRef = useRef(null);
  const mgrRef = useRef(null);

  const refresh = useCallback(async () => {
    const m = mgrRef.current; if (!m) return;
    const [list, st] = await Promise.all([m.list(), m.stats()]);
    statsRef.current = st; setRecords(list); setStats(st);
  }, []);

  useEffect(() => {
    let alive = true; let unsub = null;
    (async () => {
      const principalId = readPrincipal();
      if (!principalId) return;
      let adapter; let persist = true;
      try { adapter = createIdbAdapter(); await adapter.getAll(); } catch { adapter = createMemoryAdapter(); persist = false; } // mis. mode privat: tetap bisa dipakai, tanpa ketahanan offline
      const m = createDraftManager({
        adapter, api: apiBridge, principalId, compress: compressImage, makeThumb: makeThumbDataUrl,
        estimateStorage: async () => (typeof navigator !== "undefined" && navigator.storage?.estimate ? navigator.storage.estimate() : null),
      });
      const s = await m.init();
      if (!alive) { m.dispose(); return; }
      mgrRef.current = m; unsub = m.subscribe((ev) => { refresh(); if (ev.type === "sent") setLastSent({ at: Date.now(), count: ev.record?.items?.length ?? 0, unitCode: ev.record?.unitCode, label: ev.record?.categoryLabel, corrected: !!ev.record?.correction }); });
      setPersistent(persist); setSummary(s); setManager(m); await refresh();
      m.onOnline().catch(() => {});
    })();
    return () => { alive = false; unsub?.(); mgrRef.current?.dispose(); mgrRef.current = null; };
  }, [refresh]);

  // Retry otomatis saat sinyal kembali / aplikasi dibuka lagi.
  useEffect(() => {
    const go = () => { mgrRef.current?.onOnline().catch(() => {}); };
    const vis = () => { if (document.visibilityState === "visible") go(); };
    window.addEventListener("online", go); document.addEventListener("visibilitychange", vis);
    return () => { window.removeEventListener("online", go); document.removeEventListener("visibilitychange", vis); };
  }, []);

  // Konfirmasi bila halaman ditutup/di-refresh saat masih ada unggahan/pengiriman aktif (draf tetap tersimpan, tetapi pengiriman terhenti).
  useEffect(() => {
    const handler = (e) => { if (isActive(statsRef.current)) { e.preventDefault(); e.returnValue = "Masih ada foto yang sedang dikirim."; return e.returnValue; } return undefined; };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);
  const confirmLeave = useCallback(() => !isActive(statsRef.current) || window.confirm("Masih ada foto yang sedang dikirim. Draf tetap tersimpan di HP dan akan dilanjutkan saat aplikasi dibuka lagi. Tetap keluar?"), []);

  return { manager, persistent, summary, records, stats, online, lastSent, refresh, confirmLeave };
}

const CATEGORY_FALLBACK = "Dokumentasi";
function recLabel(r) { return r.categoryLabel || CATEGORY_FALLBACK; }

export function DraftPanel({ manager, records, online, onResume }) {
  const [error, setError] = useState("");
  if (!records.length) return null;
  const guard = async (fn) => { setError(""); try { await fn(); } catch (e) { setError(docFriendlyError(e)); } };
  const del = (r) => guard(async () => { if (window.confirm(`Hapus draft ${recLabel(r)} (${r.unitCode || "unit"})? ${r.items.length} foto di HP ini akan dibuang.`)) await manager.discard(r.id); });
  return (
    <section aria-label="Antrean kirim di HP ini" className="space-y-2 rounded-card border border-line bg-surface p-3" data-testid="draft-panel">
      <div className="flex items-center gap-2">
        <CloudOff size={16} className="text-ink3" aria-hidden />
        <p className="m-0 text-[13px] font-bold text-ink">Tersimpan di HP ({records.length})</p>
        {!online && <Badge variant="orange">Offline</Badge>}
      </div>
      {error && <p role="alert" className="m-0 rounded-btn bg-redbg px-3 py-2 text-[12.5px] text-red">{error}</p>}
      <ul className="m-0 list-none space-y-2 p-0">
        {records.map((r) => (
          <li key={r.id} className="space-y-1.5 rounded-btn bg-inset p-2.5" data-testid="draft-record" data-status={r.status} data-run-id={r.runId} data-category={r.category}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="m-0 break-words text-[13px] font-semibold text-ink [overflow-wrap:anywhere]">{r.unitCode || "Unit"} · {recLabel(r)}{r.correction ? " (koreksi)" : ""}</p>
                <p className="m-0 text-[11.5px] text-ink3">{r.items.length} foto · {draftStatusLabel(r, { online })}{r.status === STATUS.QUEUED && r.retryCount > 0 ? ` · percobaan ${r.retryCount}/${MAX_RETRY}` : ""}</p>
              </div>
              <Badge variant={r.status === STATUS.FAILED ? "red" : r.status === STATUS.SENDING ? "accent" : r.status === STATUS.QUEUED ? "orange" : "neutral"}>
                {r.status === STATUS.SENDING ? <Loader2 size={11} className="mr-1 inline animate-spin" aria-hidden /> : null}{r.status === STATUS.FAILED ? "Gagal" : r.status === STATUS.DRAFT ? "Draf" : r.status === STATUS.SENDING ? "Mengirim" : "Antre"}
              </Badge>
            </div>
            {r.status === STATUS.FAILED && r.lastError && <p className="m-0 break-words text-[12px] text-red [overflow-wrap:anywhere]" data-testid="draft-error">{r.lastError}</p>}
            <div className="flex flex-wrap gap-1.5">
              {r.status === STATUS.DRAFT && <Button size="sm" variant="secondary" className="min-h-[44px]" onClick={() => onResume(r)} data-testid="draft-resume"><Play size={13} aria-hidden /> Lanjutkan</Button>}
              {r.status === STATUS.FAILED && <Button size="sm" variant="secondary" className="min-h-[44px]" onClick={() => guard(() => manager.retry(r.id))} data-testid="draft-retry"><RotateCcw size={13} aria-hidden /> Coba Lagi</Button>}
              {r.status === STATUS.FAILED && r.outcomeKnown && <Button size="sm" variant="ghost" className="min-h-[44px]" onClick={() => guard(async () => { await manager.reopen(r.id); onResume({ ...r, status: STATUS.DRAFT }); })} data-testid="draft-edit"><Pencil size={13} aria-hidden /> Ubah</Button>}
              {r.status !== STATUS.SENDING && <Button size="sm" variant="ghost" className="min-h-[44px] text-red" onClick={() => del(r)} data-testid="draft-delete"><Trash2 size={13} aria-hidden /> Hapus draft</Button>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// Draf (record) -> item untuk EvidenceCapture. Blob lokal dipratinjau lewat object URL (dilepas saat berubah/ditutup).
function useObjectUrls(items) {
  const ref = useRef(new Map());
  const urls = new Map();
  for (const i of items) {
    if (!i.blob) continue;
    if (!ref.current.has(i.id)) ref.current.set(i.id, URL.createObjectURL(i.blob));
    urls.set(i.id, ref.current.get(i.id));
  }
  useEffect(() => {
    const live = new Set(items.filter((i) => i.blob).map((i) => i.id));
    for (const [id, u] of [...ref.current]) if (!live.has(id)) { URL.revokeObjectURL(u); ref.current.delete(id); }
  });
  useEffect(() => () => { for (const u of ref.current.values()) URL.revokeObjectURL(u); ref.current.clear(); }, []);
  return urls;
}

export function CaptureSheet({ manager, online, detail, category, correction, resumeId = null, onClose, onDone }) {
  const [rec, setRec] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const recId = useRef(resumeId);

  const load = useCallback(async () => { if (recId.current) setRec(await manager.get(recId.current)); }, [manager]);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const seed = correction ? itemsForCorrection(category.items, correction.evidenceId).map((i) => ({ url: i.url, previewUrl: i.previewUrl, caption: i.caption })) : [];
        const r = resumeId ? await manager.get(resumeId) : await manager.openDraft({
          runId: detail.runId, unitCode: detail.unit.unitCode, customerName: detail.customerName, category: category.key, categoryLabel: category.label,
          correction: correction ? { evidenceId: correction.evidenceId } : null, seedItems: seed,
        });
        if (!alive || !r) return;
        recId.current = r.id; setRec(r); setReason(r.correction?.reason || "");
        manager.uploadPending(r.id).catch(() => {});
      } catch (e) { setError(docFriendlyError(e)); }
    })();
    const unsub = manager.subscribe((ev) => { if (!ev.id || ev.id === recId.current) load(); });
    return () => { alive = false; unsub(); };
  }, [manager]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = rec?.items || [];
  const urls = useObjectUrls(items);
  const captureItems = items.map((i) => {
    const progress = manager.progressOf(rec.id, i.id);
    const status = i.url ? "done" : progress != null ? "uploading" : i.attempts >= MAX_RETRY ? "error" : "pending";
    return { id: i.id, kind: "image", status, progress: progress ?? 0, localUrl: urls.get(i.id) || null, previewUrl: i.previewUrl || i.thumb || null, caption: i.caption || "", error: i.error, pendingText: online ? "Menunggu giliran unggah" : "Tersimpan di HP · menunggu sinyal" };
  });
  const correcting = !!rec?.correction;
  const reasonOk = !correcting || reason.trim().length >= 3;
  const hasError = captureItems.some((i) => i.status === "error");
  const canSend = !!rec && items.length > 0 && reasonOk && !hasError && !busy && rec.status === STATUS.DRAFT;
  const hint = !rec ? "Memuat…" : items.length === 0 ? "Ambil atau pilih minimal satu foto." : hasError ? "Ada unggahan gagal — coba lagi atau hapus fotonya." : !reasonOk ? "Alasan koreksi wajib diisi (minimal 3 karakter)." : `${items.length} foto siap${online ? "" : " — akan terkirim otomatis saat online"}`;

  const guard = async (fn) => { setError(""); try { return await fn(); } catch (e) { setError(docFriendlyError(e)); return null; } };
  async function onAddFiles(files) {
    const r = await guard(() => manager.addFiles(rec.id, files));
    if (r?.rejected?.length) setError([...new Set(r.rejected.map((x) => x.message))].join(" "));
    manager.uploadPending(rec.id).catch(() => {});
  }
  async function send() {
    if (!canSend) return;
    setBusy(true); setError("");
    try {
      await manager.setReason(rec.id, reason).catch(() => {});
      await manager.queue(rec.id);
      const after = await manager.get(rec.id);
      if (!after) { onDone(`${items.length} foto ${correcting ? "koreksi " : ""}terkirim ke ${category.label}.`, { sent: true }); return; }
      if (after.status === STATUS.FAILED && after.outcomeKnown) { // ditolak server: hasil pasti tidak diterapkan -> tetap di sini agar bisa dibetulkan
        const err = docFriendlyError({ code: after.errorCode, message: after.lastError });
        await manager.reopen(rec.id); setError(err); return;
      }
      onDone(online ? "Foto masuk antrean kirim — akan terkirim otomatis." : "Tersimpan di HP. Foto akan terkirim otomatis saat sinyal kembali.", { sent: false });
    } catch (e) { setError(docFriendlyError(e)); } finally { setBusy(false); load(); }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={`${correcting ? "Koreksi" : "Tambah"} dokumentasi ${category.label}`} className="fixed inset-0 z-[60] flex items-end justify-center bg-black/45 sm:items-center" data-testid="capture-sheet">
      <div className="flex max-h-[94dvh] w-full max-w-[640px] flex-col rounded-t-card bg-surface shadow-xl sm:rounded-card" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="flex items-start justify-between gap-2 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <p className="m-0 text-[16px] font-bold text-ink">{correcting ? "Koreksi" : "Tambah foto"} · {category.label}</p>
            <p className="m-0 break-words text-[12px] text-ink3 [overflow-wrap:anywhere]">{detail.unit.unitCode} · {detail.customerName || "Customer"}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Tutup" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-btn text-ink2 hover:bg-hovertint" data-testid="close-capture"><X size={20} aria-hidden /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {!online && <p className="m-0 flex items-center gap-1.5 rounded-btn bg-orangebg px-3 py-2 text-[12.5px] text-orange" data-testid="offline-note"><CloudOff size={14} aria-hidden /> Offline — foto disimpan di HP ini dan dikirim otomatis saat online.</p>}
          {correcting && <p className="m-0 rounded-btn bg-orangebg px-3 py-2 text-[12.5px] text-orange">Koreksi membuat versi BARU. Versi lama tetap tersimpan di riwayat. Foto lama ikut di bawah — hapus yang salah, tambah yang benar.</p>}
          {rec && (
            <EvidenceCapture runId={detail.runId} items={captureItems} onChange={() => {}} rule={{ min: 0 }} disabled={busy || rec.status !== STATUS.DRAFT} imagesOnly withCaption reorderable
              hint={`${category.min ? `Min. ${category.min} foto disarankan untuk kategori ini. ` : ""}Foto tersimpan di HP sampai terkirim.`}
              controlled={{
                onAddFiles,
                onRemove: (id) => guard(() => manager.removeItem(rec.id, id)),
                onCaption: (id, text) => guard(() => manager.setCaption(rec.id, id, text)),
                onMove: (id, delta) => guard(() => manager.moveItem(rec.id, id, delta)),
                onRetry: (id) => guard(() => manager.retryItem(rec.id, id)),
              }} />
          )}
          {correcting && (
            <label className="block text-[12.5px] font-semibold text-ink2">Alasan koreksi (wajib)
              <textarea value={reason} onChange={(e) => { setReason(e.target.value); manager.setReason(rec.id, e.target.value).catch(() => {}); }} rows={2} maxLength={300} data-testid="correction-reason"
                className="mt-1 w-full rounded-btn border border-line bg-surface px-3 py-2 text-[13px] font-normal text-ink" placeholder="Mis. foto tertukar dengan unit lain" />
            </label>
          )}
          {error && <p role="alert" className="m-0 rounded-btn bg-redbg px-3 py-2 text-[12.5px] text-red" data-testid="submit-error">{error}</p>}
        </div>
        <div className="flex items-center gap-2 border-t border-line px-4 py-3">
          <p className="m-0 min-w-0 flex-1 text-[12px] text-ink3" data-testid="capture-hint">{hint}</p>
          <Button onClick={send} disabled={!canSend} className="min-h-[48px] min-w-[132px]" data-testid="submit-documentation">
            {busy ? <><Loader2 size={16} className="animate-spin" aria-hidden /> Mengirim…</> : online ? (correcting ? "Kirim Koreksi" : "Kirim Foto") : "Simpan & Kirim Nanti"}
          </Button>
        </div>
      </div>
    </div>
  );
}
