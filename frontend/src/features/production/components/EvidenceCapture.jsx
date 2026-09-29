import React, { useEffect, useRef } from "react";
import { Camera, Images, Loader2, RotateCcw, Trash2, Video } from "lucide-react";
import { api } from "@/api.js";
import { compressImage } from "@/utils/compressImage.js";
import { friendlyError } from "@/features/production/experience.js";

// Bukti foto/video satu tahap: ambil dari kamera (foto/video) atau galeri, unggah PER BERKAS dengan progres, coba lagi bila gagal,
// hapus, dan pratinjau. `items` dikelola induk (supaya ikut draft): { id, kind, status: uploading|done|error, progress, url, previewUrl,
// localUrl, error }. Berkas asli (File) hanya disimpan di ref selama sesi — draft menyimpan bukti yang SUDAH terunggah saja.
let seq = 0;
const nextId = () => `ev-${Date.now().toString(36)}-${++seq}`;

export function EvidenceCapture({ runId, items, onChange, rule = { min: 0, video: false }, disabled = false }) {
  const filesRef = useRef(new Map()); // id -> File (untuk coba lagi)
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // Object URL pratinjau lokal dilepas saat komponen ditutup (anti bocor).
  useEffect(() => () => {
    for (const item of itemsRef.current) if (item.localUrl) URL.revokeObjectURL(item.localUrl);
  }, []);

  const patch = (id, change) => onChange((prev) => prev.map((it) => (it.id === id ? { ...it, ...change } : it)));

  async function uploadOne(id) {
    const file = filesRef.current.get(id);
    if (!file) return;
    patch(id, { status: "uploading", progress: 0, error: null });
    try {
      const prepared = file.type.startsWith("image/") ? await compressImage(file) : file;
      const res = await api.uploadProductionV2Evidence(runId, [prepared], (p) => patch(id, { progress: p }));
      const saved = res.items?.[0];
      patch(id, { status: "done", progress: 100, url: saved.url, previewUrl: saved.previewUrl, kind: saved.kind });
      filesRef.current.delete(id);
    } catch (error) {
      patch(id, { status: "error", error: friendlyError(error) });
    }
  }

  function addFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const added = files.map((file) => {
      const id = nextId();
      filesRef.current.set(id, file);
      return { id, kind: file.type.startsWith("video/") ? "video" : "image", status: "uploading", progress: 0, localUrl: URL.createObjectURL(file), name: file.name };
    });
    onChange((prev) => [...prev, ...added]);
    added.forEach((a) => { uploadOne(a.id); });
  }

  function remove(id) {
    const item = items.find((it) => it.id === id);
    if (item?.localUrl) URL.revokeObjectURL(item.localUrl);
    filesRef.current.delete(id);
    onChange((prev) => prev.filter((it) => it.id !== id));
  }

  const doneCount = items.filter((i) => i.status === "done").length;
  const hasVideo = items.some((i) => i.status === "done" && i.kind === "video");
  const input = (accept, capture, multiple) => (e) => { addFiles(e.target.files); e.target.value = ""; };
  const btn = "flex min-h-[64px] flex-col items-center justify-center gap-1 whitespace-nowrap rounded-btn px-2 text-[13px] font-semibold active:scale-[0.98]";

  return (
    <section aria-label="Bukti foto dan video" className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <label className={`${btn} bg-accentbg text-accent`} aria-disabled={disabled}>
          <Camera size={20} aria-hidden /> Ambil Foto
          <input type="file" accept="image/*" capture="environment" hidden disabled={disabled} onChange={input()} />
        </label>
        <label className={`${btn} bg-accentbg text-accent`} aria-disabled={disabled}>
          <Video size={20} aria-hidden /> Rekam Video
          <input type="file" accept="video/*" capture="environment" hidden disabled={disabled} onChange={input()} />
        </label>
        <label className={`${btn} border border-line bg-surface text-ink2`} aria-disabled={disabled}>
          <Images size={20} aria-hidden /> Galeri
          <input type="file" accept="image/*,video/*" multiple hidden disabled={disabled} onChange={input()} />
        </label>
      </div>
      <p className={`text-[12.5px] ${doneCount >= rule.min && (!rule.video || hasVideo) ? "text-green" : "text-ink3"}`}>
        {rule.min === 0 ? "Foto/video opsional." : `Wajib ${rule.min} foto/video${rule.video ? " (minimal satu VIDEO)" : ""}.`} Terunggah: {doneCount}
      </p>
      {items.length > 0 && (
        <ul className="m-0 list-none p-0 grid grid-cols-3 gap-2">
          {items.map((item) => (
            <li key={item.id} className="relative overflow-hidden rounded-btn bg-inset">
              {item.kind === "video"
                ? <video src={item.localUrl || item.previewUrl} className="aspect-square w-full object-cover" muted playsInline preload="metadata" />
                : <img src={item.localUrl || item.previewUrl} alt="Bukti" className="aspect-square w-full object-cover" />}
              {item.kind === "video" && <span className="absolute left-1 top-1 rounded-chip bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white">VIDEO</span>}
              {item.status === "uploading" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/50 text-white" aria-live="polite">
                  <Loader2 size={20} className="animate-spin" aria-hidden />
                  <span className="text-[12px] font-semibold">{item.progress ?? 0}%</span>
                </div>
              )}
              {item.status === "error" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-red/80 p-1 text-center text-white">
                  <span className="text-[10.5px] leading-tight">{item.error || "Gagal"}</span>
                  {filesRef.current.has(item.id) && (
                    <button type="button" onClick={() => uploadOne(item.id)} className="flex min-h-[32px] items-center gap-1 rounded-chip bg-white/25 px-2 text-[11px] font-semibold">
                      <RotateCcw size={12} aria-hidden /> Coba lagi
                    </button>
                  )}
                </div>
              )}
              <button type="button" onClick={() => remove(item.id)} aria-label="Hapus bukti" disabled={disabled}
                className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white">
                <Trash2 size={14} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default EvidenceCapture;
