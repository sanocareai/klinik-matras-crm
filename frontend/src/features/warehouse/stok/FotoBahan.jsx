import React, { useRef, useState } from "react";
import { Camera, ImagePlus, Loader2, RotateCw, Trash2 } from "lucide-react";
import { api } from "@/api.js";
import { Button } from "@/components/ui/button.jsx";
import "./kontras.css";
import { periksaBerkas, ukuranTarget, perluDiperkecil, pesanGalatFoto, labelAksiUnggah } from "./fotoBahanLogic.js";

// FOTO BAHAN di drawer: unggah (kamera/galeri), ganti, putar, hapus. Satu foto utama per bahan.
// Foto hanya pelengkap pengenal bahan: TIDAK mengubah stok, harga, atau valuasi. Izin sama dengan mengubah bahan — server yang menegakkan; bila ditolak, pesannya tampil di sini.

/** Perkecil foto besar dari HP di perangkat (orientasi EXIF dihormati browser). Gagal/tidak perlu → berkas asli apa adanya; server tetap memproses ulang. */
async function siapkanFoto(berkas) {
  try {
    if (typeof createImageBitmap !== "function") return berkas;
    const bmp = await createImageBitmap(berkas, { imageOrientation: "from-image" });
    try {
      if (!perluDiperkecil(bmp.width, bmp.height, berkas.size)) return berkas;
      const t = ukuranTarget(bmp.width, bmp.height);
      const kanvas = document.createElement("canvas"); kanvas.width = t.lebar; kanvas.height = t.tinggi;
      kanvas.getContext("2d").drawImage(bmp, 0, 0, t.lebar, t.tinggi);
      const blob = await new Promise((ok) => kanvas.toBlob(ok, "image/jpeg", 0.86));
      if (!blob || blob.size === 0) return berkas;
      return new File([blob], (berkas.name || "foto").replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
    } finally { bmp.close?.(); }
  } catch { return berkas; }
}

export default function FotoBahan({ materialId, nama, fotoUrl, onUbah }) {
  const input = useRef(null);
  const [sibuk, setSibuk] = useState(""); // "" | "unggah" | "putar" | "hapus"
  const [galat, setGalat] = useState("");
  const [konfirmasiHapus, setKonfirmasiHapus] = useState(false);
  const ada = !!fotoUrl;

  async function jalankan(jenis, kerja) {
    setSibuk(jenis); setGalat("");
    try { const hasil = await kerja(); onUbah?.({ fotoUrl: hasil?.fotoUrl ?? null, fotoThumbUrl: hasil?.fotoThumbUrl ?? null }); setKonfirmasiHapus(false); }
    catch (e) { setGalat(pesanGalatFoto(e)); }
    finally { setSibuk(""); }
  }

  async function pilih(e) {
    const berkas = e.target.files?.[0]; e.target.value = ""; // boleh pilih berkas yang sama lagi
    const masalah = periksaBerkas(berkas);
    if (masalah) { setGalat(masalah); return; }
    await jalankan("unggah", async () => api.unggahFotoBahan(materialId, await siapkanFoto(berkas)));
  }

  const kunci = !!sibuk;
  return (
    <section className="rounded-card bg-surface p-4 shadow-card" aria-label="Foto bahan" data-testid="kartu-foto">
      <div className="flex items-center gap-2">
        <h3 className="m-0 min-w-0 flex-1 text-[13px] font-semibold stok-t2">Foto bahan</h3>
        {sibuk === "unggah" && <span className="flex items-center gap-1 text-[12px] stok-t2" role="status"><Loader2 size={12} className="animate-spin" aria-hidden /> Menyimpan foto…</span>}
      </div>

      {ada ? (
        <a href={fotoUrl} target="_blank" rel="noreferrer" className="mt-2 flex max-h-72 items-center justify-center overflow-hidden rounded-xl bg-inset" aria-label={`Buka foto ${nama ?? "bahan"} ukuran penuh`}>
          <img src={fotoUrl} alt={`Foto ${nama ?? "bahan"}`} className="max-h-72 w-full object-contain" data-testid="foto-bahan" loading="lazy" decoding="async" />
        </a>
      ) : (
        <button type="button" onClick={() => input.current?.click()} disabled={kunci} data-testid="foto-kosong"
          className="mt-2 flex min-h-32 w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-line bg-inset px-4 py-6 text-center outline-none hover:bg-hovertint focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-60">
          <Camera size={24} className="stok-t2" aria-hidden />
          <span className="text-[13px] font-semibold text-ink">Belum ada foto</span>
          <span className="text-[12px] stok-t2">Ketuk untuk memotret atau memilih dari galeri</span>
        </button>
      )}

      <input ref={input} type="file" accept="image/*" className="sr-only" tabIndex={-1} onChange={pilih} data-testid="input-foto" aria-label="Pilih foto bahan" />

      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" className="h-11 rounded-xl sm:h-9" onClick={() => input.current?.click()} disabled={kunci} data-testid="foto-unggah">
          {sibuk === "unggah" ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />} {labelAksiUnggah(ada)}
        </Button>
        {ada && (
          <>
            <Button variant="neutral" size="sm" className="h-11 rounded-xl sm:h-9" onClick={() => jalankan("putar", () => api.putarFotoBahan(materialId, 90))} disabled={kunci} data-testid="foto-putar" aria-label="Putar foto 90 derajat searah jarum jam">
              {sibuk === "putar" ? <Loader2 size={14} className="animate-spin" /> : <RotateCw size={14} />} Putar
            </Button>
            {!konfirmasiHapus
              ? <Button variant="neutral" size="sm" className="h-11 rounded-xl sm:h-9" onClick={() => setKonfirmasiHapus(true)} disabled={kunci} data-testid="foto-hapus"><Trash2 size={14} /> Hapus</Button>
              : (
                <span className="flex items-center gap-2" role="group" aria-label="Konfirmasi hapus foto" data-testid="foto-hapus-konfirmasi">
                  <span className="text-[12.5px] text-ink">Hapus foto ini?</span>
                  <Button variant="neutral" size="sm" className="h-11 rounded-xl sm:h-9" onClick={() => setKonfirmasiHapus(false)} disabled={kunci}>Batal</Button>
                  <Button variant="neutral" size="sm" className="h-11 rounded-xl text-red sm:h-9" onClick={() => jalankan("hapus", () => api.hapusFotoBahan(materialId))} disabled={kunci} data-testid="foto-hapus-ya">
                    {sibuk === "hapus" && <Loader2 size={14} className="animate-spin" />} Ya, hapus
                  </Button>
                </span>
              )}
          </>
        )}
      </div>
      {galat && <p className="m-0 mt-2 text-[12px] text-red" role="alert" data-testid="foto-galat">{galat}</p>}
      <p className="m-0 mt-2 text-[11px] leading-relaxed stok-t2">Foto hanya untuk mengenali bahan. Tidak mengubah stok, harga, atau nilai persediaan.</p>
    </section>
  );
}
