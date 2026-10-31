import React from "react";
import { IkBeranda, IkGrafik, IkPengaturan, IkPelangganNav } from "@/components/sanssIcons.jsx";

// Ikon navigasi workspace Finance (Fase Ringkasan Finance, 31 Okt 2026): keluarga SVG duotone yang SAMA dengan Sales CRM
// (bentuk utama solid, pendukung 35%, currentColor). Dipetakan per KUNCI HUB saat render (Layout.jsx) — data menu, urutan,
// badge, dan hak akses tidak tersentuh. Hub tanpa pemetaan memakai ikon aslinya.
function Ikon({ size = 20, className, children }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}
const S = { opacity: 0.35 };
const garis = { fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round" };

// Penjualan & Piutang — tren naik di atas alas
const IkPenjualan = (p) => (
  <Ikon {...p}>
    <rect style={S} x="3" y="3.5" width="18" height="17" rx="4" />
    <path {...garis} d="m7 15 3.4-3.6 2.6 2.2L17.2 9" />
    <path d="m14.6 8.4 3.6-.4-.4 3.6z" />
  </Ikon>
);
// Pengeluaran & Biaya — struk
const IkPengeluaran = (p) => (
  <Ikon {...p}>
    <path style={S} d="M5.5 3.8a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1V21l-2.4-1.5-2.3 1.5-2.3-1.5-2.3 1.5-2.4-1.5-.3.2z" />
    <rect x="8.4" y="7.2" width="7.2" height="1.7" rx=".85" />
    <rect x="8.4" y="11" width="7.2" height="1.7" rx=".85" />
    <rect x="8.4" y="14.8" width="4.4" height="1.7" rx=".85" />
  </Ikon>
);
// Pembelian & Supplier — keranjang
const IkPembelian = (p) => (
  <Ikon {...p}>
    <path style={S} d="M5.2 8h13.6a1 1 0 0 1 1 1.2l-1.3 8.2a2 2 0 0 1-2 1.6H7.5a2 2 0 0 1-2-1.6L4.2 9.2A1 1 0 0 1 5.2 8z" />
    <path {...garis} d="M8.4 8V6.8a3.6 3.6 0 0 1 7.2 0V8" />
    <circle cx="9.4" cy="19.8" r="1.3" />
    <circle cx="15.4" cy="19.8" r="1.3" />
  </Ikon>
);
// Kas & Bank — dompet
export const IkKasBank = (p) => (
  <Ikon {...p}>
    <rect style={S} x="2.8" y="5.2" width="18.4" height="14.2" rx="3.4" />
    <path d="M4.6 6.4a2.2 2.2 0 0 1 2.2-2.2h9.6a1.6 1.6 0 0 1 1.6 1.6v.9H6.8a.9.9 0 0 0 0 1.8h13.4v8.2a2.4 2.4 0 0 1-2.4 2.4H7a2.4 2.4 0 0 1-2.4-2.4z" />
    <circle cx="16.6" cy="13.6" r="1.4" style={{ fill: "#fff", opacity: 0.9 }} />
  </Ikon>
);
// Persediaan & HPP — kotak
const IkPersediaan = (p) => (
  <Ikon {...p}>
    <path style={S} d="M3.4 8.2 12 3.6l8.6 4.6v8.2L12 21l-8.6-4.6z" />
    <path d="M12 3.6 3.4 8.2 12 12.8l8.6-4.6z" />
    <rect x="11" y="13.4" width="2" height="7" rx="1" />
  </Ikon>
);
// Pembukuan — buku
const IkPembukuan = (p) => (
  <Ikon {...p}>
    <path style={S} d="M5 4.4A1.4 1.4 0 0 1 6.4 3H19v15.4H6.8A1.8 1.8 0 0 0 5 20.2z" />
    <path d="M5 18.4A2.4 2.4 0 0 1 7.4 16H19v4a1 1 0 0 1-1 1H7.4A2.4 2.4 0 0 1 5 18.6z" />
    <rect x="8.4" y="6.6" width="7" height="1.7" rx=".85" />
    <rect x="8.4" y="10" width="5" height="1.7" rx=".85" />
  </Ikon>
);

export const IKON_NAV_FINANCE = {
  ringkasan: IkBeranda,
  penjualan: IkPenjualan,
  pengeluaran: IkPengeluaran,
  pembelian: IkPembelian,
  kas: IkKasBank,
  karyawan: IkPelangganNav,
  persediaan: IkPersediaan,
  pembukuan: IkPembukuan,
  laporan: IkGrafik,
  pengaturan: IkPengaturan,
};
