import React from "react";

// Ikon tambahan halaman Invoice Pelanggan (keluarga duotone yang SAMA dengan financeIcons/financeIconsBiaya: bentuk utama solid, pendukung 35%, currentColor).
// Berkas terpisah agar tidak berbenturan dengan sesi lain yang mengubah berkas ikon bersama.
function Ikon({ size = 20, className, children }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}
const S = { opacity: 0.35 };
const garis = { fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round" };

/** Kalender dengan tanda seru: jatuh tempo sudah lewat. */
export const IkTempoLewat = (p) => (
  <Ikon {...p}>
    <rect style={S} x="3.4" y="4.8" width="17.2" height="16" rx="3.6" />
    <rect x="7.4" y="2.6" width="2" height="4.2" rx="1" />
    <rect x="14.6" y="2.6" width="2" height="4.2" rx="1" />
    <path {...garis} d="M12 10.4v4.2" />
    <circle cx="12" cy="17.6" r="1.15" />
  </Ikon>
);

/** Kalender kosong: jatuh tempo belum diatur. */
export const IkTempoBelum = (p) => (
  <Ikon {...p}>
    <rect style={S} x="3.4" y="4.8" width="17.2" height="16" rx="3.6" />
    <rect x="7.4" y="2.6" width="2" height="4.2" rx="1" />
    <rect x="14.6" y="2.6" width="2" height="4.2" rx="1" />
    <path {...garis} d="M8 12.6h8M8 16.4h4.4" />
  </Ikon>
);

/** Kalender dengan tanda centang: dipakai untuk tindakan "atur jatuh tempo". */
export const IkAturTempo = (p) => (
  <Ikon {...p}>
    <rect style={S} x="3.4" y="4.8" width="17.2" height="16" rx="3.6" />
    <rect x="7.4" y="2.6" width="2" height="4.2" rx="1" />
    <rect x="14.6" y="2.6" width="2" height="4.2" rx="1" />
    <path {...garis} d="m8.8 13.6 2.4 2.4 4.2-4.6" />
  </Ikon>
);
