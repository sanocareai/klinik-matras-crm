import React, { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Loader2, RotateCw, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button.jsx";
import { api } from "@/api.js";
import { MAKS_BUKTI, formatUkuran, periksaBerkas, berkasDariPaste } from "@/features/finance/refundKoreksiLogic.js";

// Unggah bukti transfer refund — DIPAKAI BERSAMA oleh Koreksi Refund dan "Lampirkan Bukti" (satu sumber, tidak ada dua implementasi yang bisa berbeda).
// Berkas diunggah dulu (status "belum dipakai" di server), baru dirujuk. Tutup dialog tanpa menyimpan = bukti yang belum dipakai dihapus lagi
// (server juga menyapu yang basi) — tidak ada berkas yatim.

/**
 * @param saatUbah  dipanggil tiap daftar unggahan berubah oleh pengguna (dialog memakainya untuk membatalkan pratinjau/kunci idempotensi).
 */
export function useUnggahBukti({ saatUbah } = {}) {
  const [unggahan, setUnggahan] = useState([]); // [{ key, file, praUrl, status: uploading|ok|gagal, bukti?, pesan? }]
  const unggahanRef = useRef([]);
  const dipakaiRef = useRef(false);
  const ubahRef = useRef(saatUbah);
  unggahanRef.current = unggahan;
  ubahRef.current = saatUbah;

  const kirim = useCallback(async (key, file) => {
    setUnggahan((s) => s.map((u) => (u.key === key ? { ...u, status: "uploading", pesan: "" } : u)));
    try {
      const r = await api.uploadBuktiRefund(file);
      setUnggahan((s) => s.map((u) => (u.key === key ? { ...u, status: "ok", bukti: r.bukti } : u)));
    } catch (e) {
      setUnggahan((s) => s.map((u) => (u.key === key ? { ...u, status: "gagal", pesan: e.message || "Gagal mengunggah" } : u)));
    }
  }, []);

  const tambahBerkas = useCallback(async (daftar) => {
    const berkas = Array.from(daftar || []);
    if (!berkas.length) return;
    ubahRef.current?.();
    for (const file of berkas) {
      const key = `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 8)}`;
      const cek = periksaBerkas(file);
      const praUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
      if (!cek.ok) { setUnggahan((s) => [...s, { key, file, praUrl, status: "gagal", pesan: cek.pesan }]); continue; }
      setUnggahan((s) => [...s, { key, file, praUrl, status: "uploading" }]);
      kirim(key, file);
    }
  }, [kirim]);

  const buang = useCallback((u) => {
    if (u.status === "ok" && u.bukti?.id) api.hapusBuktiRefund(u.bukti.id).catch(() => null);
    if (u.praUrl) URL.revokeObjectURL(u.praUrl);
    setUnggahan((s) => s.filter((x) => x.key !== u.key));
    ubahRef.current?.();
  }, []);

  // Bersihkan bukti yang belum dipakai saat dialog ditutup tanpa menyimpan.
  const bersihkan = useCallback(() => {
    if (dipakaiRef.current) return;
    for (const u of unggahanRef.current) {
      if (u.status === "ok" && u.bukti?.id) api.hapusBuktiRefund(u.bukti.id).catch(() => null);
      if (u.praUrl) URL.revokeObjectURL(u.praUrl);
    }
  }, []);
  useEffect(() => () => bersihkan(), [bersihkan]);

  /** Dipanggil setelah simpan berhasil: bukti sudah dipakai server — jangan dihapus saat dialog menutup. */
  const tandaiDipakai = useCallback(() => {
    dipakaiRef.current = true;
    for (const u of unggahanRef.current) if (u.praUrl) URL.revokeObjectURL(u.praUrl);
  }, []);

  const saatPaste = useCallback((e) => {
    const berkas = berkasDariPaste(e);
    if (berkas.length) { e.preventDefault(); tambahBerkas(berkas); }
  }, [tambahBerkas]);

  return {
    unggahan, tambahBerkas, kirim, buang, saatPaste, tandaiDipakai,
    idsBaru: unggahan.filter((u) => u.status === "ok").map((u) => u.bukti.id),
    sedangUnggah: unggahan.some((u) => u.status === "uploading"),
  };
}

/** Satu berkas bukti: thumbnail (gambar) atau ikon PDF + nama + ukuran. `aksi` = tombol di kanan. */
export function BerkasBukti({ nama, ukuran, pdf, url, praUrl, status, pesan, aksi, origin }) {
  const gambar = !pdf && (praUrl || url);
  const isi = (
    <>
      <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-surface">
        {gambar ? <img src={gambar} alt="" className="h-full w-full object-cover" /> : <FileText size={20} className="text-ink3" aria-hidden="true" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-ink">{nama}</span>
        <span className="block text-[12px] text-ink3">
          {ukuran != null && formatUkuran(ukuran)}{pdf ? " · PDF" : ""}{origin ? ` · ${origin === "BARU" ? "diunggah untuk dokumen ini" : "dibawa dari dokumen sebelumnya"}` : ""}
        </span>
        {status === "uploading" && <span className="flex items-center gap-1 text-[12px] text-ink3" role="status"><Loader2 size={12} className="animate-spin" />Mengunggah…</span>}
        {status === "gagal" && <span className="block text-[12px] text-red" role="alert">{pesan}</span>}
      </span>
    </>
  );
  return (
    <li className="flex items-center gap-2.5 rounded-lg border border-line px-2.5 py-2" data-testid="berkas-bukti">
      {url && !praUrl ? <a href={url} target="_blank" rel="noreferrer" className="flex min-w-0 flex-1 items-center gap-2.5 hover:opacity-90" title="Buka bukti di tab baru">{isi}</a> : <div className="flex min-w-0 flex-1 items-center gap-2.5">{isi}</div>}
      {aksi}
    </li>
  );
}

/** Area seret-lepas / tempel / pilih berkas + daftar unggahan. */
export function AreaUnggahBukti({ unggahan, tambahBerkas, kirim, buang }) {
  return (
    <div className="space-y-2">
      <div
        className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-line px-3 py-4 text-center"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); tambahBerkas(e.dataTransfer.files); }}
        data-testid="area-unggah"
      >
        <Upload size={18} className="text-ink3" aria-hidden="true" />
        <p className="m-0 text-[12.5px] text-ink2">Seret berkas ke sini, <strong>tempel dengan Ctrl+V</strong>, atau pilih dari perangkat.</p>
        <label className="inline-flex">
          <input type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf" className="sr-only" data-testid="input-berkas" onChange={(e) => { tambahBerkas(e.target.files); e.target.value = ""; }} />
          <span className="inline-flex h-9 cursor-pointer items-center rounded-lg bg-surface px-3 text-[13px] font-medium text-ink hover:bg-hovertint max-sm:h-11">Pilih berkas</span>
        </label>
        <p className="m-0 text-[11.5px] text-ink3">JPG, PNG, WEBP, atau PDF · maksimal 8 MB per berkas · hingga {MAKS_BUKTI} bukti</p>
      </div>
      {unggahan.length > 0 && (
        <ul className="m-0 list-none space-y-1.5 p-0" data-testid="daftar-unggahan">
          {unggahan.map((u) => (
            <BerkasBukti
              key={u.key} nama={u.file.name} ukuran={u.file.size} pdf={u.file.type === "application/pdf"} praUrl={u.praUrl} status={u.status} pesan={u.pesan}
              aksi={(
                <span className="flex shrink-0 items-center gap-1">
                  {u.status === "gagal" && periksaBerkas(u.file).ok && <Button size="sm" variant="neutral" onClick={() => kirim(u.key, u.file)} aria-label={`Coba unggah lagi ${u.file.name}`}><RotateCw size={12} />Ulangi</Button>}
                  <Button size="sm" variant="neutral" onClick={() => buang(u)} aria-label={`Hapus ${u.file.name}`} className="max-sm:min-h-11 max-sm:min-w-11"><X size={14} /></Button>
                </span>
              )}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
