import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Camera, CheckCircle2, ChevronRight, History, ImageOff, Loader2, Pencil, Plus, Search, X } from "lucide-react";
import { api } from "@/api.js";
import StandaloneShell from "@/components/StandaloneShell.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import { ProgressBar } from "@/components/ui/progress.jsx";
import EvidenceCapture from "@/features/production/components/EvidenceCapture.jsx";
import {
  DOC_FILTERS, DOC_GROUP_LABEL, DOC_SOURCE_BADGE, DOC_SOURCE_LABEL, DOC_STATUS, docBatches, docFriendlyError, isRetryableDocError, itemsForCorrection, submitState, toSubmitItems,
} from "@/features/production/documentation.js";

// Aplikasi Dokumentasi (P10B) — mobile-first/PWA. Antrean unit cohort + matriks dokumentasi kanonis (12 kategori, dari backend) +
// kamera-first/galeri, keterangan, urutan, unggah per berkas dengan progres/coba lagi, dan koreksi bersejarah.
// Dokumentasi TIDAK menyelesaikan tahap: tahap yang mewajibkan foto tetap ditutup dari Aplikasi Meja/Corner. Server = otoritas izin;
// tombol tulis hanya tampil bila `canWrite` dari server. Tidak ada harga/pembayaran/finance di layar ini.
const POLL_MS = 60_000;
const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const newKey = () => `p10b-doc-${crypto.randomUUID()}`;

function SafeImage({ src, alt = "", className = "", size = null }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => { setBroken(false); }, [src]);
  if (!src || broken) {
    return <div className={`flex items-center justify-center bg-inset text-ink3 ${className}`} style={size ? { width: size, height: size } : undefined} data-testid="image-fallback"><ImageOff size={size ? Math.round(size * 0.32) : 20} aria-hidden /></div>;
  }
  return <img src={src} alt={alt} loading="lazy" onError={() => setBroken(true)} className={className} style={size ? { width: size, height: size } : undefined} />;
}

function SourceBadge({ source, compact = false }) {
  return <Badge variant={DOC_SOURCE_BADGE[source] || "neutral"} data-testid="source-badge" data-source={source} className={compact ? "max-w-full truncate whitespace-nowrap !px-1.5 !py-0 !text-[9.5px]" : ""}>{DOC_SOURCE_LABEL[source] || source}</Badge>;
}

// Bukti tahap bisa berupa VIDEO (uji rasa, uji fondasi, ...): dirender sebagai video, bukan <img> (yang akan tampak "gambar rusak").
function MediaThumb({ item, alt, className = "h-full w-full object-cover" }) {
  const [broken, setBroken] = useState(false);
  if (item.kind !== "video") return <SafeImage src={item.url} className={className} alt={alt} />;
  if (broken) return <SafeImage src={null} className={className} />;
  return (
    <>
      <video src={item.url} muted playsInline preload="metadata" className={className} onError={() => setBroken(true)} data-testid="video-thumb" />
      <span className="absolute left-1 top-1 rounded-chip bg-black/60 px-1.5 py-0.5 text-[9.5px] font-semibold text-white">VIDEO</span>
    </>
  );
}

function MissingChips({ missing }) {
  if (!missing?.length) return <p className="text-[12px] text-green" data-testid="missing-none">Tidak ada dokumentasi yang kurang saat ini.</p>;
  return (
    <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" data-testid="missing-chips">
      {missing.map((m) => <li key={m.key}><Badge variant="red" data-missing={m.key}>{m.label} · kurang {m.missing}</Badge></li>)}
    </ul>
  );
}

function UnitCard({ item, onOpen }) {
  const p = item.progress || { done: 0, total: 0 };
  return (
    <button type="button" onClick={() => onOpen(item.runId)} data-testid="doc-unit-card" data-unit-code={item.unit.unitCode} data-run-id={item.runId}
      className="flex w-full min-w-0 flex-col gap-2.5 rounded-card bg-surface p-3.5 text-left shadow-sm active:scale-[0.99]">
      <div className="flex min-w-0 items-start gap-3">
        <SafeImage src={item.unit.photoUrl} className="shrink-0 rounded-btn object-cover" size={64} alt="" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="m-0 min-w-0 break-words text-[16px] font-bold leading-tight text-ink">{item.unit.unitCode}</p>
            <ChevronRight size={18} className="mt-0.5 shrink-0 text-ink3" aria-hidden />
          </div>
          <p className="m-0 break-words text-[13.5px] font-semibold text-ink2 [overflow-wrap:anywhere]">{item.customerName || "Customer"}</p>
          <p className="m-0 break-words text-[12px] text-ink3 [overflow-wrap:anywhere]">Resi {item.orderNumber || "—"}</p>
        </div>
      </div>
      <div className="space-y-0.5 text-[12px] text-ink3">
        <p className="m-0 break-words [overflow-wrap:anywhere]">Layanan Sales: <span className="text-ink2">{item.services.sales.length ? item.services.sales.join(", ") : "—"}</span></p>
        <p className="m-0 break-words [overflow-wrap:anywhere]">Layanan teknis: <span className="text-ink2">{item.services.technical || "belum ditetapkan"}</span></p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="accent">{item.step ? `Tahap ${item.step.stepNo}: ${item.step.label}` : item.bucketLabel}</Badge>
        <Badge variant="neutral">{item.station || "Belum dijadwalkan"}</Badge>
        {item.pic.table && <span className="text-[12px] text-ink3">PIC {item.pic.table}{item.pic.corner ? ` · ${item.pic.corner}` : ""}</span>}
      </div>
      <div className="flex items-center gap-2"><ProgressBar value={p.total ? Math.round((p.done / p.total) * 100) : 0} /><span className="shrink-0 text-[11.5px] tabular-nums text-ink3">{p.done}/{p.total} tahap</span></div>
      <div className="space-y-1.5">
        <p className="m-0 text-[12px] font-semibold text-ink2" data-testid="doc-summary">Dokumentasi {item.docs.satisfied}/{item.docs.required} foto · {item.docs.photos} terkirim</p>
        {item.docs.flags.belumDimulai && !item.docs.missing.length ? <p className="m-0 text-[12px] text-ink3">Belum dimulai — dokumentasi dibuka bertahap.</p> : <MissingChips missing={item.docs.missing} />}
      </div>
    </button>
  );
}

// ---------- Pratinjau besar satu foto ----------
function Lightbox({ item, onClose, onCorrect, canCorrect }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label="Pratinjau foto" className="fixed inset-0 z-[70] flex flex-col bg-black/90 p-3" data-testid="lightbox">
      <div className="flex justify-end"><button type="button" onClick={onClose} aria-label="Tutup pratinjau" className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white"><X size={20} aria-hidden /></button></div>
      <div className="flex min-h-0 flex-1 items-center justify-center">{item.kind === "video"
        ? <video src={item.url} controls playsInline className="max-h-full max-w-full" data-testid="lightbox-video" />
        : <SafeImage src={item.url} className="max-h-full max-w-full object-contain" alt={item.caption || item.categoryLabel} />}</div>
      <div className="mx-auto w-full max-w-[640px] space-y-1.5 rounded-card bg-surface p-3 text-[13px]">
        <div className="flex flex-wrap items-center gap-2"><SourceBadge source={item.source} /><span className="font-semibold text-ink">{item.categoryLabel}</span></div>
        {item.caption && <p className="m-0 break-words text-ink2 [overflow-wrap:anywhere]">{item.caption}</p>}
        <p className="m-0 text-[12px] text-ink3">{item.actorName ? `${item.actorName} · ` : ""}{fmtTime(item.createdAt)}</p>
        {canCorrect && item.correctable && <Button size="sm" variant="secondary" onClick={() => onCorrect(item)}><Pencil size={14} aria-hidden /> Koreksi pengiriman ini</Button>}
      </div>
    </div>
  );
}

// ---------- Kamera/galeri + kirim (tambah) atau koreksi ----------
function CaptureSheet({ detail, category, correction, onClose, onDone }) {
  const [items, setItems] = useState(() => (correction ? itemsForCorrection(category.items, correction.evidenceId) : []));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const keyRef = useRef(null);
  const state = submitState(items, { reason, correcting: !!correction });

  async function submit() {
    if (!state.ok || busy) return;
    setBusy(true); setError("");
    keyRef.current = keyRef.current || newKey();
    const body = { category: category.key, items: toSubmitItems(items), ...(correction ? { supersedesEvidenceId: correction.evidenceId, reason: reason.trim() } : {}) };
    try {
      const res = correction ? await api.correctProductionV2Documentation(detail.runId, body, keyRef.current) : await api.submitProductionV2Documentation(detail.runId, body, keyRef.current);
      keyRef.current = null;
      onDone(`${res.count} foto ${correction ? "koreksi " : ""}terkirim ke ${category.label}.`);
    } catch (e) {
      if (!isRetryableDocError(e)) keyRef.current = null;
      setError(docFriendlyError(e));
    } finally { setBusy(false); }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={`${correction ? "Koreksi" : "Tambah"} dokumentasi ${category.label}`} className="fixed inset-0 z-[60] flex items-end justify-center bg-black/45 sm:items-center" data-testid="capture-sheet">
      <div className="flex max-h-[94dvh] w-full max-w-[640px] flex-col rounded-t-card bg-surface shadow-xl sm:rounded-card" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="flex items-start justify-between gap-2 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <p className="m-0 text-[16px] font-bold text-ink">{correction ? "Koreksi" : "Tambah foto"} · {category.label}</p>
            <p className="m-0 break-words text-[12px] text-ink3 [overflow-wrap:anywhere]">{detail.unit.unitCode} · {detail.customerName || "Customer"}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Tutup" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-btn text-ink2 hover:bg-hovertint"><X size={20} aria-hidden /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {correction && <p className="m-0 rounded-btn bg-orangebg px-3 py-2 text-[12.5px] text-orange">Koreksi membuat versi BARU. Versi lama tetap tersimpan di riwayat. Foto lama ikut di bawah — hapus yang salah, tambah yang benar.</p>}
          <EvidenceCapture runId={detail.runId} items={items} onChange={setItems} rule={{ min: 0 }} disabled={busy}
            uploadFile={(runId, file, onProgress) => api.uploadProductionV2Documentation(runId, [file], onProgress)} imagesOnly withCaption reorderable
            hint={`Min. ${category.min} foto disarankan untuk kategori ini.`} />
          {correction && (
            <label className="block text-[12.5px] font-semibold text-ink2">Alasan koreksi (wajib)
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={300} data-testid="correction-reason"
                className="mt-1 w-full rounded-btn border border-line bg-surface px-3 py-2 text-[13px] font-normal text-ink" placeholder="Mis. foto tertukar dengan unit lain" />
            </label>
          )}
          {error && <p role="alert" className="m-0 rounded-btn bg-redbg px-3 py-2 text-[12.5px] text-red" data-testid="submit-error">{error}</p>}
        </div>
        <div className="flex items-center gap-2 border-t border-line px-4 py-3">
          <p className="m-0 min-w-0 flex-1 text-[12px] text-ink3">{state.ok ? `${state.count} foto siap dikirim` : state.reason}</p>
          <Button onClick={submit} disabled={!state.ok || busy} className="min-h-[48px] min-w-[132px]" data-testid="submit-documentation">
            {busy ? <><Loader2 size={16} className="animate-spin" aria-hidden /> Mengirim…</> : correction ? "Kirim Koreksi" : "Kirim Foto"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function CategoryBlock({ cat, canWrite, onAdd, onOpenPhoto, onCorrectBatch }) {
  const st = DOC_STATUS[cat.status] || DOC_STATUS.MENUNGGU;
  const batches = docBatches(cat.items);
  return (
    <section className="space-y-2 rounded-card border border-line p-3" data-testid="doc-category" data-category={cat.key} data-status={cat.status} aria-label={cat.label}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="m-0 break-words text-[14px] font-bold text-ink">{cat.label}</p>
          <p className="m-0 text-[11.5px] text-ink3 tabular-nums">{cat.count} / min {cat.min} foto{cat.status === "KURANG" ? ` · kurang ${cat.missing}` : ""}</p>
        </div>
        <Badge variant={st.variant}>{st.label}</Badge>
      </div>
      {cat.applicable && cat.items.length > 0 && (
        <ul className="m-0 grid list-none grid-cols-3 gap-2 p-0 sm:grid-cols-4">
          {cat.items.map((it, idx) => (
            <li key={`${it.url}-${idx}`} className="min-w-0">
              <button type="button" onClick={() => onOpenPhoto({ ...it, categoryLabel: cat.label, category: cat.key })} className="relative block aspect-square w-full overflow-hidden rounded-btn bg-inset" aria-label={`Lihat foto ${cat.label} ${idx + 1}`} data-testid="doc-photo">
                <MediaThumb item={it} alt={it.caption || cat.label} />
                <span className="absolute bottom-1 left-1 right-1 flex"><SourceBadge source={it.source} compact /></span>
              </button>
              {it.caption && <p className="m-0 mt-0.5 line-clamp-2 break-words text-[11px] text-ink3 [overflow-wrap:anywhere]">{it.caption}</p>}
            </li>
          ))}
        </ul>
      )}
      {cat.applicable && cat.items.length === 0 && <p className="m-0 text-[12px] text-ink3">Belum ada foto.</p>}
      {cat.applicable && canWrite && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" className="min-h-[44px]" onClick={() => onAdd(cat)} data-testid="add-photos"><Plus size={14} aria-hidden /> Tambah foto</Button>
          {batches.map((b) => (
            <Button key={b.evidenceId} size="sm" variant="ghost" className="min-h-[44px]" onClick={() => onCorrectBatch(cat, b)} data-testid="correct-batch"><Pencil size={13} aria-hidden /> Koreksi {fmtTime(b.createdAt)} ({b.count})</Button>
          ))}
        </div>
      )}
      {cat.history.length > 0 && (
        <details className="text-[12px]" data-testid="doc-history">
          <summary className="flex min-h-[32px] cursor-pointer items-center gap-1.5 text-ink3"><History size={13} aria-hidden /> Riwayat koreksi ({cat.history.length})</summary>
          <ul className="m-0 mt-1 list-none space-y-1.5 p-0">
            {cat.history.map((h) => (
              <li key={h.evidenceId} className="rounded-btn bg-inset px-2.5 py-2 text-ink2">
                <p className="m-0 break-words [overflow-wrap:anywhere]">{h.items.length} foto oleh {h.actorName || "—"} ({fmtTime(h.createdAt)}) digantikan {h.correctedBy ? `oleh ${h.correctedBy} ` : ""}({fmtTime(h.correctedAt)})</p>
                <p className="m-0 break-words text-ink3 [overflow-wrap:anywhere]">Alasan: {h.reason || "—"}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function DetailSheet({ runId, onClose, onChanged }) {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [capture, setCapture] = useState(null); // { category, correction? }
  const [photo, setPhoto] = useState(null);
  const load = useCallback(async () => {
    try { setDetail(await api.getProductionV2DocDetail(runId)); setError(""); } catch (e) { setError(docFriendlyError(e)); }
  }, [runId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!notice) return undefined; const t = setTimeout(() => setNotice(""), 5000); return () => clearTimeout(t); }, [notice]);

  const groups = useMemo(() => {
    if (!detail) return [];
    return ["BEFORE", "PROCESS", "AFTER"].map((g) => ({ key: g, label: DOC_GROUP_LABEL[g], cats: detail.categories.filter((c) => c.group === g) }));
  }, [detail]);
  const catOf = (key) => detail.categories.find((c) => c.key === key);

  return (
    <div role="dialog" aria-modal="true" aria-label="Dokumentasi unit" className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" data-testid="doc-detail">
      <div className="flex max-h-[96dvh] w-full max-w-[760px] flex-col rounded-t-card bg-base shadow-xl sm:rounded-card" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="flex items-start justify-between gap-2 border-b border-line bg-surface px-4 py-3 sm:rounded-t-card">
          <div className="min-w-0">
            <p className="m-0 break-words text-[17px] font-bold leading-tight text-ink" data-testid="detail-unit-code">{detail?.unit.unitCode || "Memuat…"}</p>
            {detail && <p className="m-0 break-words text-[12.5px] text-ink3 [overflow-wrap:anywhere]">{detail.customerName || "Customer"} · Resi {detail.orderNumber || "—"}</p>}
          </div>
          <button type="button" onClick={() => { onChanged(); onClose(); }} aria-label="Tutup" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-btn text-ink2 hover:bg-hovertint" data-testid="close-detail"><X size={20} aria-hidden /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
          {notice && <div role="status" className="rounded-btn bg-greenbg px-3 py-2.5 text-[13px] font-semibold text-green" data-testid="detail-notice">{notice}</div>}
          {error && <div role="alert" className="rounded-btn bg-redbg px-3 py-2.5 text-[13px] text-red">{error}</div>}
          {!detail && !error && <div className="space-y-3">{[1, 2, 3].map((n) => <div key={n} className="h-24 animate-pulse rounded-card bg-inset" />)}</div>}
          {detail && (
            <>
              <div className="flex items-start gap-3 rounded-card bg-surface p-3">
                <SafeImage src={detail.unit.photoUrl} className="shrink-0 rounded-btn object-cover" size={72} alt="" />
                <div className="min-w-0 space-y-1 text-[12.5px] text-ink3">
                  <p className="m-0 break-words [overflow-wrap:anywhere]">Layanan Sales: <span className="text-ink2">{detail.services.sales.length ? detail.services.sales.join(", ") : "—"}</span></p>
                  <p className="m-0 break-words [overflow-wrap:anywhere]">Layanan teknis: <span className="text-ink2">{detail.services.technical || "belum ditetapkan"}</span></p>
                  <p className="m-0">{detail.step ? `Tahap ${detail.step.stepNo}: ${detail.step.label}` : detail.bucketLabel} · {detail.station || "Belum dijadwalkan"} · PIC {detail.pic.table || "—"}</p>
                  <p className="m-0 text-ink2" data-testid="detail-total">Dokumentasi {detail.totals.satisfied}/{detail.totals.required} foto terpenuhi · {detail.totals.photos} foto</p>
                </div>
              </div>
              {!detail.canWrite && <p className="m-0 flex items-center gap-1.5 rounded-btn bg-inset px-3 py-2 text-[12.5px] text-ink3" data-testid="readonly-note"><AlertTriangle size={14} aria-hidden /> Anda hanya bisa melihat dokumentasi (tanpa izin mengirim, atau Produksi V2 belum aktif untuk unit ini).</p>}
              {groups.map((g) => (
                <div key={g.key} className="space-y-2">
                  <h3 className="m-0 text-[13px] font-bold uppercase tracking-wide text-ink2" data-testid="doc-group" data-group={g.key}>{g.label}</h3>
                  {g.cats.map((cat) => (
                    <CategoryBlock key={cat.key} cat={cat} canWrite={detail.canWrite}
                      onAdd={(c) => setCapture({ category: c })} onOpenPhoto={setPhoto}
                      onCorrectBatch={(c, b) => setCapture({ category: c, correction: b })} />
                  ))}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
      {capture && detail && (
        <CaptureSheet detail={detail} category={catOf(capture.category.key)} correction={capture.correction} onClose={() => setCapture(null)}
          onDone={async (msg) => { setCapture(null); setNotice(msg); await load(); onChanged(); }} />
      )}
      {photo && <Lightbox item={photo} canCorrect={detail?.canWrite} onClose={() => setPhoto(null)}
        onCorrect={(it) => { const cat = catOf(it.category || detail.categories.find((c) => c.label === it.categoryLabel)?.key); setPhoto(null); if (cat && it.evidenceId) setCapture({ category: cat, correction: { evidenceId: it.evidenceId } }); }} />}
    </div>
  );
}

export default function ProductionDocumentation() {
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState("ALL");
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openRun, setOpenRun] = useState(null);
  const reqRef = useRef(0);

  useEffect(() => { const t = setTimeout(() => setQDebounced(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  const load = useCallback(async () => {
    const id = ++reqRef.current;
    try {
      const d = await api.getProductionV2DocQueue({ filter, q: qDebounced });
      if (id === reqRef.current) { setData(d); setError(""); }
    } catch (e) { if (id === reqRef.current) setError(docFriendlyError(e)); } finally { if (id === reqRef.current) setLoading(false); }
  }, [filter, qDebounced]);
  useEffect(() => { setLoading(true); load(); }, [load]);
  useEffect(() => {
    const tick = () => { if (document.visibilityState === "visible" && !openRun) load(); };
    const id = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", tick); };
  }, [load, openRun]);

  const items = data?.items || [];
  return (
    <StandaloneShell title="Aplikasi Dokumentasi" subtitle={data ? `${items.length} unit${filter !== "ALL" ? " (disaring)" : ""}` : "Memuat…"} onRefresh={() => { setLoading(true); load(); }} refreshing={loading} wide>
      <div className="mx-auto w-full max-w-[1100px] space-y-3">
        {error && <div role="alert" className="rounded-btn bg-redbg px-3 py-3 text-[13.5px] text-red" data-testid="queue-error">{error}</div>}
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink3" aria-hidden />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cari customer, resi, atau kode unit" placeholder="Cari customer, resi, atau kode unit"
            className="min-h-[46px] w-full rounded-btn border border-line bg-surface pl-9 pr-3 text-[14px] text-ink" data-testid="doc-search" />
        </div>
        <div role="tablist" aria-label="Saring antrean dokumentasi" className="-mx-3 flex gap-1.5 overflow-x-auto px-3 pb-1" data-testid="doc-filters">
          {DOC_FILTERS.map((f) => (
            <button key={f.key} role="tab" aria-selected={filter === f.key} onClick={() => setFilter(f.key)} data-filter={f.key}
              className={`flex min-h-[40px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-chip px-3 text-[13px] font-semibold ${filter === f.key ? "bg-accent text-white" : "bg-surface text-ink2"}`}>
              {f.label}<span className={`rounded-chip px-1.5 text-[11px] tabular-nums ${filter === f.key ? "bg-white/25" : "bg-inset text-ink3"}`}>{data?.counts?.[f.key] ?? 0}</span>
            </button>
          ))}
        </div>
        {loading && !data ? (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">{[1, 2, 3].map((n) => <div key={n} className="h-44 animate-pulse rounded-card bg-inset" />)}</div>
        ) : data?.readerMode === "OFF" ? (
          <div className="rounded-card bg-surface p-6 text-center" data-testid="doc-reader-off"><Camera className="mx-auto mb-2 text-ink3" size={32} aria-hidden /><p className="m-0 font-semibold text-ink">Produksi V2 belum aktif</p><p className="m-0 mt-1 text-[13px] text-ink3">Antrean dokumentasi terisi setelah Production V2 diaktifkan untuk unit terkait.</p></div>
        ) : items.length === 0 ? (
          <div className="rounded-card bg-surface p-6 text-center" data-testid="doc-empty"><CheckCircle2 className="mx-auto mb-2 text-green" size={32} aria-hidden />
            <p className="m-0 font-semibold text-ink">{qDebounced || filter !== "ALL" ? "Tidak ada unit yang cocok" : "Belum ada unit untuk didokumentasikan"}</p>
            <p className="m-0 mt-1 text-[13px] text-ink3">{qDebounced || filter !== "ALL" ? "Ubah kata kunci atau saringan." : "Unit cohort Produksi V2 akan muncul di sini."}</p></div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3" data-testid="doc-list">{items.map((item) => <UnitCard key={item.runId} item={item} onOpen={setOpenRun} />)}</div>
        )}
      </div>
      {openRun && <DetailSheet runId={openRun} onClose={() => setOpenRun(null)} onChanged={load} />}
    </StandaloneShell>
  );
}
