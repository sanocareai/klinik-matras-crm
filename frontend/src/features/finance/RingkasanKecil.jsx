import React, { useId, useState } from "react";
import { ChevronDown, ChevronRight, Info } from "lucide-react";

// Kontrol bersama halaman Ringkasan Keuangan (gaya: styles/sanss-finance.css, dikunci ke .fin-ring).
// Tiga jenis kontrol, satu bahasa visual:
//   1. NavLink  — pindah ke halaman/daftar lain: label singkat + chevron KANAN.
//   2. Pembuka / Akordeon — buka/tutup isi di tempat: tombol lembut + chevron BAWAH yang berbalik saat terbuka (aria-expanded).
//   3. InfoBuka — penjelasan: tombol ikon "i" bernama aksesibel; dibuka lewat klik/tap/Enter/Spasi (bukan hover saja).

/** Buka/tutup di tempat. `kelas` mengatur varian: "" (lembut) | "fin-pill" (pil sekunder) | kelas lain dari konteks. */
export function Pembuka({ buka, onToggle, id, children, className = "", ikon = true, ikonKiri = null, ...rest }) {
  return (
    <button type="button" className={`fin-pembuka ${className}`} aria-expanded={buka} aria-controls={id} onClick={onToggle} {...rest}>
      {ikonKiri}{children}{ikon && <ChevronDown size={16} aria-hidden="true" className="fin-chev" />}
    </button>
  );
}

/** Navigasi ke halaman/daftar lain: label singkat + chevron kanan. Teks biru medium, tanpa garis bawah. */
export function NavLink({ onClick, children, className = "", label }) {
  return (
    <button type="button" className={`fin-nav ${className}`} onClick={onClick} aria-label={label}>
      <span>{children}</span><ChevronRight size={16} aria-hidden="true" />
    </button>
  );
}

/** Tombol lembut kecil (mis. paginasi). `kiri`/`kanan` = ikon opsional. */
export function TombolLembut({ onClick, disabled, children, kiri = null, kanan = null, className = "", ...rest }) {
  return (
    <button type="button" className={`fin-tombol ${className}`} onClick={onClick} disabled={disabled} {...rest}>
      {kiri}<span>{children}</span>{kanan}
    </button>
  );
}

/** Baris accordion selebar baris: ikon kiri, judul, status opsional, chevron di ujung (bawah → atas saat terbuka). */
export function Akordeon({ buka, onToggle, id, Ikon, judul, status = null, children }) {
  return (
    <div className="fin-akor">
      <button type="button" className="fin-akor-tombol" aria-expanded={buka} aria-controls={id} onClick={onToggle}>
        {Ikon && <span className="fin-akor-ikon" aria-hidden="true"><Ikon size={17} /></span>}
        <span className="fin-akor-judul">{judul}</span>
        {status}
        <ChevronDown size={17} aria-hidden="true" className="fin-chev fin-akor-chev" />
      </button>
      {buka && <div id={id} className="fin-akor-isi">{children}</div>}
    </div>
  );
}

/** Ikon "i" yang membuka penjelasan LEWAT KLIK/TAP/ENTER (bukan hover saja). Penjelasan tampil di tempatnya (bukan melayang). */
export function InfoBuka({ label, children, className = "" }) {
  const [buka, setBuka] = useState(false);
  const id = useId();
  return (
    <>
      <button type="button" className={`fin-info ${className}`} aria-expanded={buka} aria-controls={id} aria-label={`Penjelasan: ${label}`} onClick={() => setBuka((v) => !v)}>
        <Info size={16} aria-hidden="true" />
      </button>
      {buka && <div id={id} className="fin-info-isi" role="note">{children}</div>}
    </>
  );
}

/** Chip cakupan waktu (hanya dipakai bila didukung sumber datanya). */
export function Cakupan({ children, nada = "netral" }) {
  return <span className={`fin-cakupan fin-cakupan-${nada}`}>{children}</span>;
}

export const angkaId = (n) => Number(n).toLocaleString("id-ID");
