import React, { useState, useCallback, useEffect } from "react";
import Cropper from "react-easy-crop";
import { X, ZoomIn } from "lucide-react";

// Modal reframe/crop foto profil — dipakai BERSAMA oleh Pengaturan.jsx (ganti
// foto sendiri) dan Pengguna.jsx (admin ganti foto siapa pun), D-167,
// 19 September 2026, laporan owner: "ketika ganti foto, buat agar bisa di
// reframe, crop". SATU komponen, bukan disalin ke 2 tempat — pola yang sama
// dipegang di seluruh proyek ini (NewComplaintCaseForm, processAvatarUpload,
// dkk) supaya 2 titik upload avatar tidak diam-diam menyimpang.
//
// react-easy-crop dipilih (bukan menulis ulang drag/pinch/zoom sendiri
// seperti compressImage.js yang murni resize tanpa interaksi) — geser+zoom
// interaktif adalah kategori masalah yang jauh lebih besar dari resize
// biasa, dan library kecil tanpa dependency lain lebih mudah dirawat
// daripada pointer-math buatan sendiri (CLAUDE.md §2: "mudah dimaintain
// oleh 1 orang").
//
// Output: SELALU persegi (rasio 1:1) — dipotong jadi Blob JPEG 512x512 di
// canvas, siap dikirim sebagai FormData field "file" ke endpoint avatar
// yang sudah ada (backend TETAP resize ke 256px, jadi ini bukan pengganti
// kompresi server, cuma memberi user kendali FRAMING sebelum itu terjadi).

async function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.addEventListener("load", () => resolve(img));
    img.addEventListener("error", reject);
    img.src = src;
  });
}

async function buatBlobTerpotong(imageSrc, area, outputSize = 512) {
  const image = await loadImage(imageSrc);
  const canvas = document.createElement("canvas");
  canvas.width = outputSize;
  canvas.height = outputSize;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(
    image,
    area.x, area.y, area.width, area.height,
    0, 0, outputSize, outputSize,
  );
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
}

// `file` = File yang baru dipilih dari <input type="file">.
// `onCancel()` — batal, tidak upload apa pun.
// `onCropped(blob)` — user klik "Gunakan Foto Ini", blob siap di-upload.
export default function AvatarCropModal({ file, onCancel, onCropped }) {
  const [imageSrc] = useState(() => URL.createObjectURL(file));
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // URL object dibuat sekali per instance modal — wajib dilepas saat modal
  // ditutup (batal ATAU selesai), bukan menunggu garbage collector.
  useEffect(() => () => URL.revokeObjectURL(imageSrc), [imageSrc]);

  const handleCropComplete = useCallback((_areaPercent, areaPixels) => {
    setCroppedAreaPixels(areaPixels);
  }, []);

  async function handleSave() {
    if (!croppedAreaPixels) return;
    setSaving(true);
    setError("");
    try {
      const blob = await buatBlobTerpotong(imageSrc, croppedAreaPixels);
      onCropped(blob);
    } catch (err) {
      setError("Gagal memproses foto: " + err.message);
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-box" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">Atur Foto Profil</h3>
          <button className="modal-close" onClick={onCancel}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <div style={{ position: "relative", width: "100%", height: 300, background: "#111", borderRadius: 10, overflow: "hidden" }}>
            <Cropper
              image={imageSrc}
              crop={crop}
              zoom={zoom}
              aspect={1}
              cropShape="round"
              showGrid={false}
              minZoom={1}
              maxZoom={4}
              restrictPosition={true}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={handleCropComplete}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}>
            <ZoomIn size={16} color="var(--text-muted)" />
            <input
              type="range" min={1} max={4} step={0.01} value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              style={{ flex: 1 }}
              aria-label="Perbesar foto"
            />
          </div>
          <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--text-muted)" }}>
            Geser foto untuk mengatur posisi, gunakan slider untuk memperbesar/memperkecil.
          </p>
          {error && <p style={{ color: "var(--color-danger)", fontSize: 13, margin: "8px 0 0" }}>{error}</p>}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>Batal</button>
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving || !croppedAreaPixels}>
            {saving ? "Memproses..." : "Gunakan Foto Ini"}
          </button>
        </div>
      </div>
    </div>
  );
}
