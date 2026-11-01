import React from "react";

// Ikon tambahan halaman Kas & Bank (keluarga duotone yang SAMA dengan financeIcons/financeIconsBiaya: bentuk utama solid, pendukung 35%, currentColor).
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

/** Dua panah berlawanan: transfer antar-rekening. */
export const IkTransfer = (p) => (
  <Ikon {...p}>
    <rect style={S} x="3" y="3.6" width="18" height="16.8" rx="4.4" />
    <path {...garis} d="M7.4 9.4h9.2m0 0-2.7-2.7m2.7 2.7-2.7 2.7M16.6 14.6H7.4m0 0 2.7-2.7m-2.7 2.7 2.7 2.7" />
  </Ikon>
);

/** Buku dengan garis: mutasi buku. */
export const IkMutasi = (p) => (
  <Ikon {...p}>
    <path style={S} d="M5.4 3.4h10.2a2.4 2.4 0 0 1 2.4 2.4v13.4a1.4 1.4 0 0 1-1.4 1.4H6.8a2.4 2.4 0 0 1-2.4-2.4V4.4a1 1 0 0 1 1-1z" />
    <rect x="7.6" y="8" width="7.4" height="1.8" rx=".9" />
    <rect x="7.6" y="11.6" width="7.4" height="1.8" rx=".9" />
    <rect x="7.6" y="15.2" width="4.6" height="1.8" rx=".9" />
  </Ikon>
);

/** Panah masuk (hijau di UI): uang masuk. */
export const IkMasuk = (p) => (
  <Ikon {...p}>
    <circle style={S} cx="12" cy="12" r="9.2" />
    <path {...garis} d="M12 7.4v9m0 0-3.4-3.4m3.4 3.4 3.4-3.4" />
  </Ikon>
);

/** Panah keluar (oranye di UI): uang keluar. */
export const IkKeluar = (p) => (
  <Ikon {...p}>
    <circle style={S} cx="12" cy="12" r="9.2" />
    <path {...garis} d="M12 16.6v-9m0 0-3.4 3.4M12 7.6l3.4 3.4" />
  </Ikon>
);

/** Timbangan/seimbang: saldo akhir. */
export const IkSaldo = (p) => (
  <Ikon {...p}>
    <rect style={S} x="3.4" y="3.6" width="17.2" height="16.8" rx="4.2" />
    <rect x="7" y="12.6" width="2.4" height="4.4" rx="1" />
    <rect x="10.8" y="9.4" width="2.4" height="7.6" rx="1" />
    <rect x="14.6" y="7" width="2.4" height="10" rx="1" />
  </Ikon>
);
