import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Camera, History, Images, Pencil, Plus, UserRound, MapPin } from "lucide-react";
import { api } from "@/api.js";
import { useOnline } from "@/components/StandaloneShell.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import { ProgressBar } from "@/components/ui/progress.jsx";
import { CaptureSheet } from "@/features/production/DocumentationDraftUi.jsx";
import {
  DOC_GROUP_KEYS, DOC_GROUP_LABEL, DOC_STATUS, docBatches, docCompleteness, docFriendlyError, fmtDocTime, groupStats, suggestCategory, thumbMeta,
} from "@/features/production/documentation.js";
import { JobPhoto } from "@/features/production/workerApp/JobCard.jsx";
import { Lightbox, MediaThumb, MissingChips, SourceBadge } from "./DocUi.jsx";
import "./doc-app.css";

// Detail dokumentasi satu unit (P12D): ringkasan, segmen Before / Proses / After, kategori dengan minimum & kekurangan DARI SERVER, thumbnail dengan
// sumber/waktu/pengunggah, dan bilah aksi lengket "Ambil Foto" (+ galeri, pilih kategori). Pengiriman memakai CaptureSheet/draf IndexedDB yang SUDAH ADA —
// bukan antrean/store baru. Dokumentasi tidak mengubah tahap/status produksi. Server = otoritas izin (canWrite).
function CategoryBlock({ cat, canWrite, onAdd, onOpenPhoto, onCorrectBatch }) {
  const st = DOC_STATUS[cat.status] || DOC_STATUS.MENUNGGU;
  const batches = docBatches(cat.items);
  return (
    <section className="wa-card space-y-3 p-4" data-testid="doc-category" data-category={cat.key} data-status={cat.status} aria-label={cat.label}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="wa-wrap m-0 text-[16px] font-extrabold text-ink">{cat.label}</p>
          <p className="m-0 text-[12.5px] tabular-nums text-ink3" data-testid="category-count">{cat.count} / min {cat.min} foto{cat.status === "KURANG" ? ` · kurang ${cat.missing}` : ""}</p>
        </div>
        <Badge variant={st.variant}>{st.label}</Badge>
      </div>
      {cat.applicable && cat.items.length > 0 && (
        <ul className="da-thumbs" data-testid="doc-thumbs">
          {cat.items.map((it, idx) => {
            const meta = thumbMeta(it);
            return (
              <li key={`${it.url}-${idx}`} className="min-w-0" data-testid="doc-thumb">
                <button type="button" onClick={() => onOpenPhoto({ ...it, categoryLabel: cat.label, category: cat.key })} className="da-thumb" aria-label={`Lihat foto ${cat.label} ${idx + 1}`} data-testid="doc-photo">
                  <MediaThumb item={it} alt={it.caption || cat.label} />
                  <span className="da-thumb-chip"><SourceBadge source={it.source} compact /></span>
                </button>
                <p className="da-meta" data-testid="thumb-meta"><span className="block font-semibold text-ink2">{meta.time}</span><span className="block truncate">{meta.actor}</span></p>
                {it.caption && <p className="da-meta line-clamp-2 !mt-0.5 !text-ink2">{it.caption}</p>}
              </li>
            );
          })}
        </ul>
      )}
      {cat.applicable && cat.items.length === 0 && <p className="m-0 text-[13px] text-ink3" data-testid="category-empty">Belum ada foto.</p>}
      {!cat.applicable && <p className="m-0 text-[13px] text-ink3">Tidak berlaku untuk unit ini.</p>}
      {cat.applicable && canWrite && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" className="min-h-[44px]" onClick={() => onAdd(cat)} data-testid="add-photos" data-mutates><Plus size={14} aria-hidden /> Tambah foto</Button>
          {batches.map((b) => (
            <Button key={b.evidenceId} size="sm" variant="ghost" className="min-h-[44px]" onClick={() => onCorrectBatch(cat, b)} data-testid="correct-batch" data-evidence-id={b.evidenceId} data-mutates><Pencil size={13} aria-hidden /> Koreksi {fmtDocTime(b.createdAt)} ({b.count})</Button>
          ))}
        </div>
      )}
      {cat.history.length > 0 && (
        <details className="text-[12px]" data-testid="doc-history">
          <summary className="flex min-h-[32px] cursor-pointer items-center gap-1.5 text-ink3"><History size={13} aria-hidden /> Riwayat koreksi ({cat.history.length})</summary>
          <ul className="m-0 mt-1 list-none space-y-1.5 p-0">
            {cat.history.map((h) => (
              <li key={h.evidenceId} className="rounded-btn bg-inset px-2.5 py-2 text-ink2">
                <p className="m-0 break-words [overflow-wrap:anywhere]">{h.items.length} foto oleh {h.actorName || "—"} ({fmtDocTime(h.createdAt)}) digantikan {h.correctedBy ? `oleh ${h.correctedBy} ` : ""}({fmtDocTime(h.correctedAt)})</p>
                <p className="m-0 break-words text-ink3 [overflow-wrap:anywhere]">Alasan: {h.reason || "—"}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

export default function DocDetail({ runId, group, onGroup, drafts, resume, onResumeConsumed, onChanged }) {
  const online = useOnline();
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [capture, setCapture] = useState(null); // { category, correction?, resumeId?, initialFiles? }
  const [photo, setPhoto] = useState(null);
  const [manualKey, setManualKey] = useState(null);

  const load = useCallback(async () => {
    try { setDetail(await api.getProductionV2DocDetail(runId)); setError(""); } catch (e) { setError(docFriendlyError(e)); }
  }, [runId]);
  useEffect(() => { setDetail(null); load(); }, [load]);
  // Pengiriman latar belakang (antrean offline) selesai -> segarkan matriks.
  useEffect(() => { if (drafts.lastSent) load(); }, [drafts.lastSent, load]);
  useEffect(() => { if (!notice) return undefined; const t = setTimeout(() => setNotice(""), 5000); return () => clearTimeout(t); }, [notice]);
  useEffect(() => { setManualKey(null); }, [group, runId]);

  const cats = detail?.categories || [];
  const catOf = (key) => cats.find((c) => c.key === key);
  const suggested = useMemo(() => suggestCategory(cats, group), [cats, group]);
  const selKey = manualKey && catOf(manualKey)?.applicable ? manualKey : suggested?.key || "";
  const groupCats = cats.filter((c) => c.group === group);
  const canWrite = !!detail?.canWrite && !!drafts.manager;
  const comp = docCompleteness({ required: detail?.totals?.required, satisfied: detail?.totals?.satisfied });

  // "Lanjutkan" dari panel draf: buka sheet kamera untuk draf itu begitu detail termuat.
  useEffect(() => {
    if (!resume || !detail) return;
    const cat = detail.categories.find((c) => c.key === resume.category);
    if (cat) { onGroup(cat.group); setCapture({ category: cat, correction: resume.correction ? { evidenceId: resume.correction.evidenceId } : undefined, resumeId: resume.id }); }
    onResumeConsumed();
  }, [resume, detail]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (files) => { const cat = catOf(selKey); if (cat && files.length) setCapture({ category: cat, initialFiles: files }); };
  // FileList itu HIDUP: mengosongkan value input mengosongkannya juga — salin ke array DULU (bug yang ditemukan QA browser: foto kamera/galeri hilang sebelum sheet terbuka).
  const onInput = (e) => { const files = Array.from(e.target.files || []); e.target.value = ""; pick(files); };

  return (
    <div data-testid="doc-detail" data-run-id={runId}>
      {notice && <div role="status" className="mb-3 rounded-btn bg-greenbg px-3 py-3 text-[13.5px] font-semibold text-green" data-testid="detail-notice">{notice}</div>}
      {error && (
        <div role="alert" className="mb-3 flex items-start justify-between gap-3 rounded-btn bg-redbg px-3 py-3 text-[13.5px] text-red" data-testid="detail-error">
          <span>{error}</span><button type="button" onClick={load} className="shrink-0 font-bold underline" data-testid="detail-retry">Coba lagi</button>
        </div>
      )}
      {!detail && !error && <div className="space-y-3">{[1, 2, 3].map((n) => <div key={n} className="h-28 animate-pulse rounded-card bg-inset" />)}</div>}
      {detail && (
        <div className="wa-detail">
          <div className="space-y-3.5">
            <div className="wa-card" data-testid="detail-identity">
              <JobPhoto job={{ photoUrl: detail.unit.photoUrl, customerName: detail.customerName, unitCode: detail.unit.unitCode }} />
              <div className="space-y-2 p-4">
                <p className="wa-wrap m-0 text-[20px] font-extrabold leading-tight text-ink" data-testid="detail-unit-code">{detail.unit.unitCode}</p>
                <p className="wa-wrap m-0 text-[13.5px] text-ink3">{detail.customerName || "Customer"} · Resi {detail.orderNumber || "—"}</p>
                <div className="space-y-0.5 text-[12.5px] text-ink3">
                  <p className="wa-wrap m-0">Layanan Sales: <span className="font-semibold text-ink2">{detail.services.sales.length ? detail.services.sales.join(", ") : "—"}</span></p>
                  <p className="wa-wrap m-0">Layanan teknis: <span className="font-semibold text-ink2">{detail.services.technical || "belum ditetapkan"}</span></p>
                </div>
                <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink3">
                  <span className="rounded-full bg-accentbg px-2.5 py-0.5 font-bold text-accent">{detail.step ? `Tahap ${detail.step.stepNo}: ${detail.step.label}` : detail.bucketLabel}</span>
                  <span className="inline-flex items-center gap-1"><MapPin size={12} aria-hidden /> {detail.station || "Belum dijadwalkan"}</span>
                  <span className="inline-flex items-center gap-1"><UserRound size={12} aria-hidden /> PIC {detail.pic.table || "—"}</span>
                </p>
                <div className="space-y-1.5 rounded-btn bg-inset p-3">
                  <div className="flex items-center justify-between gap-2"><p className="m-0 text-[13px] font-extrabold text-ink" data-testid="detail-total">Dokumentasi {detail.totals.satisfied}/{detail.totals.required} foto terpenuhi · {detail.totals.photos} foto</p><span className="text-[12px] font-bold tabular-nums text-accent">{comp.pct}%</span></div>
                  <ProgressBar value={comp.pct} />
                  <MissingChips missing={detail.docs?.missing} />
                </div>
              </div>
            </div>
            {!detail.canWrite && <p className="m-0 flex items-start gap-2 rounded-btn bg-inset px-3 py-3 text-[13px] text-ink2" data-testid="readonly-note"><AlertTriangle size={15} className="mt-px shrink-0" aria-hidden /> Anda hanya bisa melihat dokumentasi (tanpa izin mengirim, atau Produksi V2 belum aktif untuk unit ini).</p>}
          </div>
          <div className="space-y-3.5">
            <div role="tablist" aria-label="Kelompok dokumentasi" className="da-seg" data-testid="doc-groups">
              {DOC_GROUP_KEYS.map((g) => {
                const gs = groupStats(cats, g);
                return (
                  <button key={g} role="tab" type="button" aria-selected={group === g} onClick={() => onGroup(g)} className="da-seg-btn" data-testid="doc-group" data-group={g}>
                    {DOC_GROUP_LABEL[g]}
                    <span className="da-seg-sub" data-bad={gs.missing > 0 ? "1" : "0"}>{gs.applicable === 0 ? "—" : gs.missing > 0 ? `kurang ${gs.missing}` : `${gs.photos} foto`}</span>
                  </button>
                );
              })}
            </div>
            {groupCats.map((cat) => (
              <CategoryBlock key={cat.key} cat={cat} canWrite={canWrite}
                onAdd={(c) => setCapture({ category: c })} onOpenPhoto={setPhoto}
                onCorrectBatch={(c, b) => setCapture({ category: c, correction: b })} />
            ))}
          </div>
        </div>
      )}

      {canWrite && (
        <div className="wa-actionbar" data-testid="doc-actionbar"><div className="wa-actionbar-inner">
          {!online && <p className="m-0 rounded-btn bg-orangebg px-3 py-2 text-[12.5px] text-orange" data-testid="bar-offline">Offline — foto disimpan di HP ini dan dikirim otomatis saat online.</p>}
          <div className="da-bar-row">
            <select className="da-select" aria-label="Kategori foto" value={selKey} onChange={(e) => setManualKey(e.target.value)} data-testid="bar-category">
              {DOC_GROUP_KEYS.map((g) => {
                const opts = cats.filter((c) => c.group === g && c.applicable);
                return opts.length ? <optgroup key={g} label={DOC_GROUP_LABEL[g]}>{opts.map((c) => <option key={c.key} value={c.key}>{c.label}{c.status === "KURANG" ? ` · kurang ${c.missing}` : ""}</option>)}</optgroup> : null;
              })}
            </select>
            <label className="da-secondary" aria-disabled={!selKey} data-mutates>
              <Images size={18} aria-hidden /> Galeri
              <input type="file" accept="image/*" multiple hidden disabled={!selKey} onChange={onInput} data-testid="bar-gallery" />
            </label>
          </div>
          <label className="wa-primary da-primary-label" aria-disabled={!selKey} data-mutates>
            <Camera size={21} aria-hidden /> Ambil Foto
            <input type="file" accept="image/*" capture="environment" hidden disabled={!selKey} onChange={onInput} data-testid="bar-camera" />
          </label>
        </div></div>
      )}

      {capture && detail && drafts.manager && (
        <CaptureSheet manager={drafts.manager} online={drafts.online} detail={detail} category={catOf(capture.category.key)} correction={capture.correction} resumeId={capture.resumeId} initialFiles={capture.initialFiles}
          onClose={() => { setCapture(null); drafts.refresh(); }}
          onDone={async (msg) => { setCapture(null); setNotice(msg); await load(); onChanged(); drafts.refresh(); }} />
      )}
      {photo && <Lightbox item={photo} canCorrect={detail?.canWrite} onClose={() => setPhoto(null)}
        onCorrect={(it) => { const cat = catOf(it.category || cats.find((c) => c.label === it.categoryLabel)?.key); setPhoto(null); if (cat && it.evidenceId) setCapture({ category: cat, correction: { evidenceId: it.evidenceId } }); }} />}
    </div>
  );
}
