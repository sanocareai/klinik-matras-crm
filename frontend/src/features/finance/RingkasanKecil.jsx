import React, { useId, useState } from "react";
import { ChevronDown, Info } from "lucide-react";

// Komponen kecil bersama untuk halaman Ringkasan Keuangan (gaya: styles/sanss-finance.css, dikunci ke .fin-ring).

/** Tombol buka/tutup dengan status terbuka/tertutup yang jelas (aria-expanded + aria-controls) dan fokus keyboard. */
export function Pembuka({ buka, onToggle, id, children, className = "", ikon = true }) {
  return (
    <button type="button" className={`fin-pembuka ${className}`} aria-expanded={buka} aria-controls={id} onClick={onToggle}>
      {children}{ikon && <ChevronDown size={14} aria-hidden="true" className="fin-pembuka-panah" />}
    </button>
  );
}

/** Ikon "i" yang membuka penjelasan LEWAT KLIK/TAP/ENTER (bukan hover saja). Penjelasan tampil di tempatnya (bukan melayang). */
export function InfoBuka({ label, children, className = "" }) {
  const [buka, setBuka] = useState(false);
  const id = useId();
  return (
    <>
      <button type="button" className={`fin-info ${className}`} aria-expanded={buka} aria-controls={id} aria-label={`Penjelasan: ${label}`} onClick={() => setBuka((v) => !v)}>
        <Info size={15} aria-hidden="true" />
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
