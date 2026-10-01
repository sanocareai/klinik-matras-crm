import React, { useEffect, useRef } from "react";
import { ArrowLeft, ArrowRight, Camera, Images, Loader2, RotateCcw, Trash2, Video } from "lucide-react";
import { api } from "@/api.js";
import { compressImage } from "@/utils/compressImage.js";
import { friendlyError } from "@/features/production/experience.js";

// Bukti foto/video satu tahap: ambil dari kamera (foto/video) atau galeri, unggah PER BERKAS dengan progres, coba lagi bila gagal,
// hapus, dan pratinjau. `items` dikelola induk (supaya ikut draft): { id, kind, status: uploading|done|error, progress, url, previewUrl,
// localUrl, error }. Berkas asli (File) hanya disimpan di ref selama sesi — draft menyimpan bukti yang SUDAH terunggah saja.
//
// P10B — komponen yang SAMA dipakai Aplikasi Dokumentasi lewat prop opsional (perilaku bawaan tahap TIDAK berubah):
//   uploadFile(runId, file, onProgress)  pengunggah pengganti (default: bukti tahap)    imagesOnly  sembunyikan tombol video, hanya foto
//   withCaption                          kolom keterangan per foto (item.caption)        reorderable tombol geser urutan (kiri/kanan)
//   controlled {onAddFiles,onRemove,onCaption,onMove,onRetry}  induk memegang SELURUH state & unggahan (draf offline IndexedDB, P10B);
//                                        komponen hanya menampilkan item (status: uploading|done|error|pending) dan meneruskan aksi.
let seq = 0;
const nextId = () => `ev-${Date.now().toString(36)}-${++seq}`;

export function EvidenceCapture({ runId, items, onChange, rule = { min: 0, video: false }, disabled = false, uploadFile = null, imagesOnly = false, withCaption = false, reorderable = false, hint = null, controlled = null }) {
  const filesRef = useRef(new Map()); // id -> File (untuk coba lagi)
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // Object URL pratinjau lokal dilepas saat komponen ditutup (anti bocor).
  useEffect(() => () => {
    for (const item of itemsRef.current) if (item.localUrl) URL.revokeObjectURL(item.localUrl);
  }, []);

  const patch = (id, change) => {
    if (controlled) { if ("caption" in change) controlled.onCaption?.(id, change.caption); return; }
    onChange((prev) => prev.map((it) => (it.id === id ? { ...it, ...change } : it)));
  };

  async function uploadOne(id) {
    const file = filesRef.current.get(id);
    if (!file) return;
    patch(id, { status: "uploading", progress: 0, error: null });
    try {
      const prepared = file.type.startsWith("image/") ? await compressImage(file) : file;
      const onProgress = (p) => patch(id, { progress: p });
      const res = uploadFile ? await uploadFile(runId, prepared, onProgress) : await api.uploadProductionV2Evidence(runId, [prepared], onProgress);
      const saved = res.items?.[0];
      patch(id, { status: "done", progress: 100, url: saved.url, previewUrl: saved.previewUrl, kind: saved.kind });
      filesRef.current.delete(id);
    } catch (error) {
      patch(id, { status: "error", error: friendlyError(error) });
    }
  }

  function addFiles(fileList) {
    const files = Array.from(fileList || []).filter((f) => !imagesOnly || f.type.startsWith("image/"));
    if (!files.length) return;
    if (controlled) { controlled.onAddFiles?.(files); return; }
    const added = files.map((file) => {
      const id = nextId();
      filesRef.current.set(id, file);
      return { id, kind: file.type.startsWith("video/") ? "video" : "image", status: "uploading", progress: 0, localUrl: URL.createObjectURL(file), name: file.name, caption: "" };
    });
    onChange((prev) => [...prev, ...added]);
    added.forEach((a) => { uploadOne(a.id); });
  }

  function remove(id) {
    if (controlled) { controlled.onRemove?.(id); return; }
    const item = items.find((it) => it.id === id);
    if (item?.localUrl) URL.revokeObjectURL(item.localUrl);
    filesRef.current.delete(id);
    onChange((prev) => prev.filter((it) => it.id !== id));
  }

  function move(id, delta) {
    if (controlled) { controlled.onMove?.(id, delta); return; }
    onChange((prev) => {
      const from = prev.findIndex((it) => it.id === id);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      const [it] = next.splice(from, 1);
      next.splice(to, 0, it);
      return next;
    });
  }

  const doneCount = items.filter((i) => i.status === "done").length;
  const hasVideo = items.some((i) => i.status === "done" && i.kind === "video");
  const input = () => (e) => { addFiles(e.target.files); e.target.value = ""; };
  const btn = "flex min-h-[64px] flex-col items-center justify-center gap-1 whitespace-nowrap rounded-btn px-2 text-[13px] font-semibold active:scale-[0.98]";

  return (
    <section aria-label={imagesOnly ? "Foto dokumentasi" : "Bukti foto dan video"} className="space-y-3" data-testid="evidence-capture">
      <div className={`grid gap-2 ${imagesOnly ? "grid-cols-2" : "grid-cols-3"}`}>
        <label className={`${btn} bg-accentbg text-accent`} aria-disabled={disabled}>
          <Camera size={20} aria-hidden /> Ambil Foto
          <input type="file" accept="image/*" capture="environment" hidden disabled={disabled} onChange={input()} data-testid="capture-photo" />
        </label>
        {!imagesOnly && (
          <label className={`${btn} bg-accentbg text-accent`} aria-disabled={disabled}>
            <Video size={20} aria-hidden /> Rekam Video
            <input type="file" accept="video/*" capture="environment" hidden disabled={disabled} onChange={input()} />
          </label>
        )}
        <label className={`${btn} border border-line bg-surface text-ink2`} aria-disabled={disabled}>
          <Images size={20} aria-hidden /> Galeri
          <input type="file" accept={imagesOnly ? "image/*" : "image/*,video/*"} multiple hidden disabled={disabled} onChange={input()} data-testid="capture-gallery" />
        </label>
      </div>
      <p className={`text-[12.5px] ${doneCount >= rule.min && (!rule.video || hasVideo) ? "text-green" : "text-ink3"}`}>
        {hint ?? (rule.min === 0 ? "Foto/video opsional." : `Wajib ${rule.min} foto/video${rule.video ? " (minimal satu VIDEO)" : ""}.`)} Terunggah: {doneCount}
      </p>
      {items.length > 0 && (
        <ul className={`m-0 grid list-none gap-2 p-0 ${withCaption ? "grid-cols-2" : "grid-cols-3"}`} data-testid="capture-items">
          {items.map((item, index) => (
            <li key={item.id} className="min-w-0 overflow-hidden rounded-btn bg-inset" data-testid="capture-item" data-status={item.status}>
              <div className="relative">
                {item.kind === "video"
                  ? <video src={item.localUrl || item.previewUrl} className="aspect-square w-full object-cover" muted playsInline preload="metadata" />
                  : <img src={item.localUrl || item.previewUrl || item.thumb} alt="Bukti" className="aspect-square w-full object-cover" />}
                {item.kind === "video" && <span className="absolute left-1 top-1 rounded-chip bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white">VIDEO</span>}
                {reorderable && <span className="absolute left-1 top-1 rounded-chip bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white" data-testid="capture-order">{index + 1}</span>}
                {item.status === "uploading" && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/50 text-white" aria-live="polite">
                    <Loader2 size={20} className="animate-spin" aria-hidden />
                    <span className="text-[12px] font-semibold">{item.progress ?? 0}%</span>
                  </div>
                )}
                {item.status === "pending" && (
                  <div className="absolute inset-x-0 bottom-0 bg-black/60 px-1.5 py-1 text-center text-[10.5px] font-semibold text-white" data-testid="capture-pending">{item.pendingText || "Menunggu sinyal"}</div>
                )}
                {item.status === "error" && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-red/80 p-1 text-center text-white">
                    <span className="text-[10.5px] leading-tight">{item.error || "Gagal"}</span>
                    {(controlled ? !!controlled.onRetry : filesRef.current.has(item.id)) && (
                      <button type="button" onClick={() => (controlled ? controlled.onRetry(item.id) : uploadOne(item.id))} data-testid="capture-retry" className="flex min-h-[32px] items-center gap-1 rounded-chip bg-white/25 px-2 text-[11px] font-semibold">
                        <RotateCcw size={12} aria-hidden /> Coba lagi
                      </button>
                    )}
                  </div>
                )}
                <button type="button" onClick={() => remove(item.id)} aria-label="Hapus bukti" data-testid="capture-remove" disabled={disabled}
                  className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white">
                  <Trash2 size={14} aria-hidden />
                </button>
              </div>
              {(withCaption || reorderable) && (
                <div className="space-y-1.5 p-1.5">
                  {withCaption && (
                    <input type="text" {...(controlled ? { defaultValue: item.caption || "" } : { value: item.caption || "" })} maxLength={200} onChange={(e) => patch(item.id, { caption: e.target.value })} disabled={disabled}
                      aria-label="Keterangan foto" placeholder="Keterangan (opsional)" data-testid="capture-caption"
                      className="w-full min-w-0 rounded-btn border border-line bg-surface px-2 py-1.5 text-[12.5px] text-ink" />
                  )}
                  {reorderable && items.length > 1 && (
                    <div className="flex gap-1.5">
                      <button type="button" onClick={() => move(item.id, -1)} disabled={disabled || index === 0} aria-label="Geser ke depan" data-testid="capture-move-up"
                        className="flex h-9 flex-1 items-center justify-center rounded-btn bg-surface text-ink2 disabled:opacity-40"><ArrowLeft size={15} aria-hidden /></button>
                      <button type="button" onClick={() => move(item.id, 1)} disabled={disabled || index === items.length - 1} aria-label="Geser ke belakang" data-testid="capture-move-down"
                        className="flex h-9 flex-1 items-center justify-center rounded-btn bg-surface text-ink2 disabled:opacity-40"><ArrowRight size={15} aria-hidden /></button>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default EvidenceCapture;
