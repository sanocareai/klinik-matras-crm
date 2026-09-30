import React, { useRef, useState } from "react";
import { Camera, ImageOff } from "lucide-react";
import { api } from "@/api.js";

// P9B.1 — thumbnail rasio TETAP dipakai di kartu Status Produksi & Rencana Produksi (kecil, tidak menambah
// tinggi kartu di mobile) dan drawer (besar). Sumber foto (pickup driver vs manual) sudah diresolusi di
// backend — komponen ini murni menampilkan URL bertanda-tangan yang dikirim, tidak pernah menebak.
export function UnitPhotoThumb({ photoUrl, size = 44, className = "" }) {
  return (
    <div className={`shrink-0 overflow-hidden rounded-btn bg-inset ${className}`} style={{ width: size, height: size }}>
      {photoUrl
        ? <img src={photoUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
        : <div className="flex h-full w-full items-center justify-center text-ink3"><ImageOff size={Math.round(size * 0.32)} aria-hidden /></div>}
    </div>
  );
}

// Blok unggah manual (foto besar + tombol) untuk drawer/detail — HANYA tampil kalau pemanggil sudah
// memutuskan boleh (canUpload, biasanya role ADMIN/OWNER/PRODUCTION_LEAD) DAN unit belum punya foto pickup
// driver. Server tetap yang menegakkan izin sesungguhnya (PRODUCTION_ASSIGNMENT_WRITE) — properti ini murni
// menyembunyikan tombol dari role yang jelas-jelas tidak berwenang, bukan satu-satunya penjagaan.
export function UnitPhotoPanel({ unitId, photoUrl, canUpload, onUploaded }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  async function pick(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true); setError("");
    try {
      const result = await api.uploadUnitPhoto(unitId, file);
      onUploaded?.(result.photoUrl);
    } catch (err) {
      setError(err.message || "Gagal mengunggah foto");
    } finally { setBusy(false); }
  }

  return (
    <div className="flex items-center gap-3 rounded-btn border border-line p-3">
      <UnitPhotoThumb photoUrl={photoUrl} size={64} />
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-semibold text-ink">Foto identitas unit</p>
        <p className="text-[11.5px] text-ink3">{photoUrl ? "Sumber: pickup driver atau unggahan manual." : "Belum ada foto — diambil otomatis dari pickup driver bila tersedia."}</p>
        {error && <p role="alert" className="mt-1 text-[11px] text-red">{error}</p>}
      </div>
      {canUpload && !photoUrl && (
        <>
          <button type="button" onClick={() => inputRef.current?.click()} disabled={busy}
            className="flex shrink-0 items-center gap-1 rounded-btn border border-line px-2.5 py-1.5 text-[12px] font-semibold text-ink2 hover:bg-hovertint disabled:opacity-50">
            <Camera size={13} aria-hidden /> {busy ? "Mengunggah…" : "Unggah Foto"}
          </button>
          <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={pick} />
        </>
      )}
    </div>
  );
}
