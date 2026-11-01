import React from "react";

// Ikon tambahan halaman Pengeluaran & Pengajuan Biaya (keluarga duotone yang SAMA dengan sanssIcons/financeIcons: bentuk utama solid,
// pendukung 35%, currentColor). Berkas terpisah agar tidak berbenturan dengan sesi lain yang mengubah financeIcons.jsx.
function Ikon({ size = 20, className, children }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}
const S = { opacity: 0.35 };
const garis = { fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round" };

export const IkJam = (p) => (
  <Ikon {...p}>
    <circle style={S} cx="12" cy="12" r="9.2" />
    <path {...garis} d="M12 7.2V12l3.2 2" />
  </Ikon>
);
export const IkDokumen = (p) => (
  <Ikon {...p}>
    <path style={S} d="M6.2 3h7.3l4.3 4.3V19a2 2 0 0 1-2 2H6.2a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
    <path d="M13.5 3v3.3a1 1 0 0 0 1 1h3.3z" />
    <rect x="7.4" y="11.2" width="8.2" height="1.7" rx=".85" />
    <rect x="7.4" y="14.8" width="5.6" height="1.7" rx=".85" />
  </Ikon>
);
export const IkRevisi = (p) => (
  <Ikon {...p}>
    <rect style={S} x="3.6" y="4.4" width="15.6" height="15.6" rx="3.6" />
    <path d="m16.9 3.3 2.4 2.4-7.1 7.1-3.1.7.7-3.1z" />
  </Ikon>
);
export const IkKoin = (p) => (
  <Ikon {...p}>
    <ellipse style={S} cx="12" cy="17.2" rx="7.6" ry="3.4" />
    <ellipse cx="12" cy="11.6" rx="7.6" ry="3.4" />
    <ellipse style={{ fill: "#fff", opacity: 0.55 }} cx="12" cy="11.6" rx="3.8" ry="1.5" />
  </Ikon>
);
export const IkOrang = (p) => (
  <Ikon {...p}>
    <circle style={S} cx="17.2" cy="8.8" r="2.8" />
    <circle cx="9" cy="8" r="3.6" />
    <path d="M2.4 18.6c0-3 2.9-5 6.6-5s6.6 2 6.6 5v.6a1 1 0 0 1-1 1H3.4a1 1 0 0 1-1-1z" />
  </Ikon>
);
export const IkMesin = (p) => (
  <Ikon {...p}>
    <circle style={S} cx="12" cy="12" r="8.6" />
    <circle cx="12" cy="12" r="3.2" />
    <path {...garis} d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2" />
  </Ikon>
);
export const IkGudang = (p) => (
  <Ikon {...p}>
    <path style={S} d="M3.4 8.2 12 3.6l8.6 4.6v8.2L12 21l-8.6-4.6z" />
    <path d="M12 3.6 3.4 8.2 12 12.8l8.6-4.6z" />
  </Ikon>
);
export const IkMegafon = (p) => (
  <Ikon {...p}>
    <path style={S} d="M4 9.6 15.5 5v14L4 14.4a1.4 1.4 0 0 1 0-4.8z" />
    <path d="M15.5 5.6 20 4v16l-4.5-1.6z" />
    <path {...garis} d="M7.6 15v3.4" />
  </Ikon>
);
export const IkKantor = (p) => (
  <Ikon {...p}>
    <rect style={S} x="3.2" y="6.6" width="17.6" height="14" rx="3" />
    <path d="M9 6.6V5.4A1.4 1.4 0 0 1 10.4 4h3.2A1.4 1.4 0 0 1 15 5.4v1.2" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    <rect x="3.2" y="11.2" width="17.6" height="1.8" />
  </Ikon>
);
export const IkKaryawan = (p) => (
  <Ikon {...p}>
    <circle style={S} cx="12" cy="12" r="9.2" />
    <circle cx="12" cy="9.6" r="2.8" />
    <path d="M6.4 17.6c.9-2.3 3.1-3.4 5.6-3.4s4.7 1.1 5.6 3.4A8.6 8.6 0 0 1 12 20.8a8.6 8.6 0 0 1-5.6-3.2z" />
  </Ikon>
);
export const IkInfoStrip = (p) => (
  <Ikon {...p}>
    <circle style={S} cx="12" cy="12" r="9.2" />
    <rect x="11" y="10.4" width="2" height="6.4" rx="1" />
    <circle cx="12" cy="7.6" r="1.25" />
  </Ikon>
);
