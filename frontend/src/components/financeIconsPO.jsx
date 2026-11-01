import React from "react";

// Ikon halaman Pesanan Pembelian (PO). Keluarga duotone yang SAMA dengan sanssIcons/financeIcons/financeIconsBiaya:
// bentuk utama solid, bentuk pendukung 35%, currentColor, viewBox 24. Berkas terpisah supaya tidak berbenturan dengan sesi lain.
function Ikon({ size = 20, className, children }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}
const S = { opacity: 0.35 };
const garis = { fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round" };

/** Dokumen pesanan: lembar dengan baris item dan tanda centang. */
export const IkPesanan = (p) => (
  <Ikon {...p}>
    <path style={S} d="M6.2 3h8.1l4.2 4.2V19a2 2 0 0 1-2 2H6.2a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
    <path d="M14.3 3v3.2a1 1 0 0 0 1 1h3.2z" />
    <path {...garis} d="m8.2 14.2 2.2 2.2 4.2-4.6" />
  </Ikon>
);

/** Kotak barang (isometrik) untuk stok/bahan. */
export const IkKotak = (p) => (
  <Ikon {...p}>
    <path style={S} d="M12 2.8 20 7v10l-8 4.2L4 17V7z" />
    <path d="M12 2.8 20 7l-8 4.2L4 7z" />
    <path style={{ fill: "#fff", opacity: 0.55 }} d="M12 11.2V21.2l-8-4.2V7z" />
  </Ikon>
);

/** Bahan/gulungan: dipakai sebagai penanda baris bahan. */
export const IkBahan = (p) => (
  <Ikon {...p}>
    <rect style={S} x="3.4" y="4" width="17.2" height="16" rx="4" />
    <path d="M12 7.4 16.6 10v4.8L12 17.4 7.4 14.8V10z" />
  </Ikon>
);

/** Alur/langkah: tiga titik tersambung. */
export const IkAlur = (p) => (
  <Ikon {...p}>
    <circle style={S} cx="5.6" cy="6.4" r="2.8" />
    <circle style={S} cx="18.4" cy="17.6" r="2.8" />
    <circle cx="12" cy="12" r="2.8" />
    <path {...garis} d="M7.6 8.2 10 10.2M14 13.8l2.4 2" />
  </Ikon>
);

/** Tag harga: dampak Harga Berlaku. */
export const IkHarga = (p) => (
  <Ikon {...p}>
    <path style={S} d="M3.4 12.2V5.4A2 2 0 0 1 5.4 3.4h6.8l8.2 8.2a2 2 0 0 1 0 2.8l-6 6a2 2 0 0 1-2.8 0z" />
    <circle cx="8.4" cy="8.4" r="1.7" />
  </Ikon>
);

/** Truk kedatangan barang. */
export const IkKedatangan = (p) => (
  <Ikon {...p}>
    <rect style={S} x="2.6" y="6" width="12.2" height="9.6" rx="2" />
    <path d="M14.8 9.4h3.2l3 3.2v3a1.6 1.6 0 0 1-1.6 1.6h-4.6z" />
    <circle cx="7.4" cy="17.6" r="2" />
    <circle cx="17.4" cy="17.6" r="2" />
  </Ikon>
);

/** Kalender: lembar berlatar 35% dengan penanda tanggal solid. */
export const IkKalender = (p) => (
  <Ikon {...p}>
    <rect style={S} x="3.4" y="5" width="17.2" height="15.6" rx="3" />
    <path d="M7.4 2.8a1 1 0 0 1 1 1V6a1 1 0 0 1-2 0V3.8a1 1 0 0 1 1-1zM16.6 2.8a1 1 0 0 1 1 1V6a1 1 0 0 1-2 0V3.8a1 1 0 0 1 1-1z" />
    <rect x="7.2" y="12" width="3.4" height="3.2" rx="0.9" />
  </Ikon>
);

/** Jam termin pembayaran: wajah jam 35% dengan jarum solid. */
export const IkTermin = (p) => (
  <Ikon {...p}>
    <circle style={S} cx="12" cy="12" r="9.2" />
    <path {...garis} strokeWidth="2.1" d="M12 7v5.2l3.3 2" />
  </Ikon>
);
