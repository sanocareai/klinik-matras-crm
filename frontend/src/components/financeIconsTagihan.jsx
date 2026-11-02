import React from "react";

// Ikon layar Tagihan supplier. Keluarga duotone yang sama dengan financeIconsPO/Biaya: bentuk utama solid, pendukung 35%, currentColor, viewBox 24.
function Ikon({ size = 20, className, children }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}
const S = { opacity: 0.35 };
const garis = { fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round" };

/** Dua orang: menunggu persetujuan. */
export const IkPersetujuan = (p) => (
  <Ikon {...p}>
    <circle style={S} cx="16.6" cy="8.6" r="2.9" />
    <path style={S} d="M14.2 19.8c0-2.6 1.6-4.6 4-4.6 1.4 0 2.6.7 3.2 1.8v1.8c0 .6-.4 1-1 1z" />
    <circle cx="9" cy="8.6" r="3.3" />
    <path d="M2.6 19.2c0-3.1 2.8-5.4 6.4-5.4s6.4 2.3 6.4 5.4v.2c0 .5-.4.9-.9.9H3.5c-.5 0-.9-.4-.9-.9z" />
  </Ikon>
);

/** Tumpukan koin: uang muka. */
export const IkKoin = (p) => (
  <Ikon {...p}>
    <ellipse style={S} cx="12" cy="17.2" rx="7.6" ry="3.2" />
    <path style={S} d="M4.4 12.4v4.8c0 1.8 3.4 3.2 7.6 3.2s7.6-1.4 7.6-3.2v-4.8z" />
    <ellipse cx="12" cy="7.6" rx="7.6" ry="3.2" />
    <path d="M4.4 7.6v4.8c0 1.8 3.4 3.2 7.6 3.2s7.6-1.4 7.6-3.2V7.6c0 1.8-3.4 3.2-7.6 3.2S4.4 9.4 4.4 7.6z" />
  </Ikon>
);

/** Gedung supplier. */
export const IkGedung = (p) => (
  <Ikon {...p}>
    <rect style={S} x="4.2" y="3.2" width="11.6" height="17.6" rx="2" />
    <path d="M15.8 9.2h2.6a1.8 1.8 0 0 1 1.8 1.8v8a1.8 1.8 0 0 1-1.8 1.8h-2.6z" />
    <rect x="7.4" y="6.8" width="2.2" height="2.2" rx="0.6" />
    <rect x="7.4" y="11.2" width="2.2" height="2.2" rx="0.6" />
    <rect x="7.4" y="15.6" width="2.2" height="2.2" rx="0.6" />
  </Ikon>
);

/** Pencarian kosong / dokumen coret untuk keadaan kosong. */
export const IkKosong = (p) => (
  <Ikon {...p}>
    <path style={S} d="M6.2 3h8.1l4.2 4.2V19a2 2 0 0 1-2 2H6.2a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
    <path {...garis} d="M8.6 13.2h6.8M8.6 16.6h4" />
  </Ikon>
);
