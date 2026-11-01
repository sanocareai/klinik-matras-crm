import React from "react";

// Ikon halaman Pemasukan: keluarga SVG duotone yang sama dengan ikon Sales CRM/Finance (bentuk utama solid, pendukung 35%, currentColor).
function Ikon({ size = 20, className, children }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}
const S = { opacity: 0.35 };
const garis = { fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round" };

// Menunggu verifikasi — jam
export const IkJam = (p) => (
  <Ikon {...p}>
    <circle style={S} cx="12" cy="12" r="9.2" />
    <path {...garis} d="M12 7v5.2l3.4 2" />
  </Ikon>
);
// Pemasukan lain — koin bertumpuk
export const IkKoin = (p) => (
  <Ikon {...p}>
    <ellipse style={S} cx="12" cy="7.2" rx="7.4" ry="3.4" />
    <path d="M4.6 10.4c0 1.9 3.3 3.4 7.4 3.4s7.4-1.5 7.4-3.4v3.2c0 1.9-3.3 3.4-7.4 3.4s-7.4-1.5-7.4-3.4z" />
    <path style={S} d="M4.6 15.6c0 1.9 3.3 3.4 7.4 3.4s7.4-1.5 7.4-3.4v1.2c0 1.9-3.3 3.4-7.4 3.4s-7.4-1.5-7.4-3.4z" />
  </Ikon>
);
// Dana masuk bukan pendapatan — panah masuk ke kotak
export const IkDanaMasuk = (p) => (
  <Ikon {...p}>
    <rect style={S} x="3" y="3.2" width="18" height="17.6" rx="4.4" />
    <path {...garis} d="M12 7.2v8.2m0 0-3.2-3.2m3.2 3.2 3.2-3.2" />
  </Ikon>
);
// Dikecualikan — lingkaran dengan strip
export const IkDikecualikan = (p) => (
  <Ikon {...p}>
    <circle style={S} cx="12" cy="12" r="9.2" />
    <path {...garis} d="M8 12h8" />
  </Ikon>
);
// Data sebelum sistem — arsip
export const IkArsip = (p) => (
  <Ikon {...p}>
    <rect style={S} x="3" y="4" width="18" height="5" rx="1.8" />
    <path d="M4.6 10.4h14.8v7.4a2.4 2.4 0 0 1-2.4 2.4H7a2.4 2.4 0 0 1-2.4-2.4z" />
    <rect x="9.2" y="13" width="5.6" height="1.8" rx=".9" style={{ fill: "#fff", opacity: 0.85 }} />
  </Ikon>
);
