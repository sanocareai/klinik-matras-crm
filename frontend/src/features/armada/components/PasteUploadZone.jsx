import React, { useEffect, useRef, useState } from "react";
import { ClipboardPaste, X } from "lucide-react";
import { cn } from "@/lib/utils.js";

// Zona unggah + tempel (D-086, 5 September 2026 — dipindah jadi komponen
// bersama 8 September 2026 supaya JobDetailDrawer.jsx [Route Planner/
// Jadwal & Penugasan] bisa pakai persis yang sama, bukan menulis ulang).
// Dua cara mengisi: (1) klik lalu pilih file biasa, (2) fokuskan lalu
// Ctrl+V — kalau gambar sudah di-copy dari WhatsApp Web (klik kanan
// gambar > Copy image, atau Ctrl+C di image viewer-nya), ClipboardEvent
// browser membawa Blob gambarnya LANGSUNG, tidak perlu men-download ke
// disk dulu lalu pilih file itu secara manual — persis yang diminta owner
// ("copy paste tanpa download").
//
// Preview object URL dibuat SEKALI saat file ditambahkan (bukan di setiap
// render) dan di-revoke saat file itu dihapus/komponen lepas — mencegah
// kebocoran memori dari createObjectURL yang tidak pernah dibersihkan.
export default function PasteUploadZone({ files, onFilesChange, multiple, label }) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    // Revoke SEMUA object URL saat komponen benar-benar lepas (drawer
    // ditutup) — pembersihan terakhir, pelengkap dari revoke per-item di
    // removeAt() untuk kasus normal (dihapus manual/disubmit).
    return () => { files.forEach((f) => URL.revokeObjectURL(f.previewUrl)); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function addFiles(rawFiles) {
    const imgs = rawFiles.filter((f) => f.type.startsWith("image/"));
    if (imgs.length === 0) return;
    const withPreview = imgs.map((file) => ({ file, previewUrl: URL.createObjectURL(file) }));
    if (multiple) {
      onFilesChange([...files, ...withPreview]);
    } else {
      files.forEach((f) => URL.revokeObjectURL(f.previewUrl)); // ganti satu-satunya slot
      onFilesChange(withPreview.slice(0, 1));
    }
  }

  function handlePaste(e) {
    const items = Array.from(e.clipboardData?.items || []);
    const imgs = items.filter((it) => it.kind === "file" && it.type.startsWith("image/")).map((it) => it.getAsFile()).filter(Boolean);
    if (imgs.length > 0) { e.preventDefault(); addFiles(imgs); }
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    addFiles(Array.from(e.dataTransfer?.files || []));
  }

  function removeAt(i) {
    URL.revokeObjectURL(files[i].previewUrl);
    onFilesChange(files.filter((_, idx) => idx !== i));
  }

  return (
    <div>
      {label && <p className="mb-1 text-[10.5px] font-semibold text-ink2">{label}</p>}
      <div
        tabIndex={0}
        role="button"
        aria-label={`${label || "Foto"} — klik atau tempel gambar`}
        onPaste={handlePaste}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={cn(
          "flex cursor-pointer items-center justify-center gap-1.5 rounded-btn border-2 border-dashed px-3 py-3 text-center text-[11px] outline-none transition-colors",
          dragOver ? "border-accent bg-accentbg text-accent" : "border-border text-ink3 hover:border-accent hover:text-accent focus-visible:border-accent"
        )}
      >
        <ClipboardPaste size={14} className="shrink-0" />
        <span>Klik lalu tempel gambar (Ctrl+V), atau klik untuk pilih file</span>
        <input
          ref={inputRef} type="file" accept="image/*" multiple={multiple} className="hidden"
          onChange={(e) => { addFiles(Array.from(e.target.files || [])); e.target.value = ""; }}
        />
      </div>
      {files.length > 0 && (
        <div className="mt-2 grid grid-cols-4 gap-2">
          {files.map((f, i) => (
            <div key={f.previewUrl} className="group relative">
              <img src={f.previewUrl} alt="" className="aspect-square w-full rounded-btn border border-border object-cover" />
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); removeAt(i); }}
                aria-label="Hapus gambar ini"
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red text-white shadow"
              >
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
