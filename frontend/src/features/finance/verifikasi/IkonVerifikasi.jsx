import React from "react";

// Ikon halaman Verifikasi pembayaran: keluarga SVG duotone yang sama dengan Pemasukan/Ringkasan (bentuk utama solid, pendukung 35%, currentColor).
function Ikon({ size = 20, className, children }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}
const S = { opacity: 0.35 };
const garis = { fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round" };

// Ditandai lunas oleh Sales — dokumen dengan centang (status di CRM, belum terbukti)
export const IkKlaimSales = (p) => (
  <Ikon {...p}>
    <rect style={S} x="4.2" y="2.8" width="15.6" height="18.4" rx="4" />
    <path {...garis} d="M8.6 12.4l2.4 2.4 4.6-4.9" />
  </Ikon>
);
// Bukti — gambar
export const IkBukti = (p) => (
  <Ikon {...p}>
    <rect style={S} x="3" y="4" width="18" height="16" rx="4" />
    <circle cx="9" cy="9.6" r="1.7" />
    <path d="M4.4 17.6l4.6-4.6 3.2 3.2 2.6-2.6 4.8 4.8a3.2 3.2 0 0 1-2.4 1H7.2a2.8 2.8 0 0 1-2.8-2.8z" />
  </Ikon>
);
