import React from "react";

// Keluarga ikon navigasi Sales CRM (Fase 1 kerangka bersama, 31 Okt 2026):
// SVG duotone/filled 24×24 — bentuk utama solid, bentuk pendukung 35% — memakai
// currentColor sehingga warna mengikuti tema (biru saat tidak aktif, putih di
// atas pill aktif). Antarmuka sama dengan ikon lucide yang dipakai SidebarLink
// (`size`, `className`), jadi dipasang tanpa mengubah komponen menu.
// HANYA dipakai di sidebar Sales CRM (Layout.jsx memetakan per rute); divisi
// lain tetap memakai ikon lucide mereka.
function Ikon({ size = 20, className, children }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}
const S = { opacity: 0.35 };                                   // bentuk pendukung
const garis = { fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round" };

export const IkBeranda = (p) => (
  <Ikon {...p}>
    <path style={S} d="M5 10.6 12 5.2l7 5.4V19a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z" />
    <path d="M12 3 2.9 10.1a.95.95 0 0 0 1.2 1.5L12 5.4l7.9 6.2a.95.95 0 1 0 1.2-1.5z" />
    <rect x="9.9" y="14" width="4.2" height="6" rx="1.2" />
  </Ikon>
);
export const IkKotakMasuk = (p) => (
  <Ikon {...p}>
    <rect style={S} x="2.8" y="5" width="18.4" height="14" rx="3.2" />
    <path {...garis} d="M5 8.2 12 13.4l7-5.2" />
  </Ikon>
);
export const IkPelangganNav = (p) => (
  <Ikon {...p}>
    <circle style={S} cx="17.2" cy="8.8" r="2.8" />
    <path style={S} d="M16.7 13.9c3 .1 5 1.8 5 4.3v.4a1 1 0 0 1-1 1h-3.3c.3-.5.5-1.1.5-1.7 0-1.7-.5-3.2-1.2-4z" />
    <circle cx="9" cy="8" r="3.6" />
    <path d="M2.4 18.6c0-3 2.9-5 6.6-5s6.6 2 6.6 5v.6a1 1 0 0 1-1 1H3.4a1 1 0 0 1-1-1z" />
  </Ikon>
);
export const IkCorong = (p) => (
  <Ikon {...p}>
    <path style={S} d="M3.5 4h17a1 1 0 0 1 .75 1.65L14.5 13.5V19a1 1 0 0 1-1.5.9l-3-1.8a1 1 0 0 1-.5-.9v-3.7L2.75 5.65A1 1 0 0 1 3.5 4z" />
    <path d="M9.5 13.5h5V19a1 1 0 0 1-1.5.9l-3-1.8a1 1 0 0 1-.5-.9z" />
  </Ikon>
);
export const IkPesanan = (p) => (
  <Ikon {...p}>
    <rect style={S} x="4.5" y="4" width="15" height="17" rx="3.2" />
    <rect x="8.8" y="2.4" width="6.4" height="4.2" rx="1.6" />
    <rect x="8" y="10.2" width="8" height="1.7" rx=".85" />
    <rect x="8" y="13.7" width="8" height="1.7" rx=".85" />
    <rect x="8" y="17.1" width="4.6" height="1.7" rx=".85" />
  </Ikon>
);
export const IkGaleri = (p) => (
  <Ikon {...p}>
    <rect style={S} x="2.8" y="4" width="18.4" height="16" rx="3.6" />
    <path d="M2.8 17.2l5.1-5.6a1 1 0 0 1 1.5 0l3.1 3.4 2.3-2.3a1 1 0 0 1 1.4 0l4.9 4.7v.2a3.4 3.4 0 0 1-3.4 3.4H6.2a3.4 3.4 0 0 1-3.4-3.4z" />
    <circle cx="16.4" cy="9" r="1.9" />
  </Ikon>
);
export const IkKomplain = (p) => (
  <Ikon {...p}>
    <path style={S} d="M10.6 3.9a1.6 1.6 0 0 1 2.8 0l8.2 14.6a1.6 1.6 0 0 1-1.4 2.4H3.8a1.6 1.6 0 0 1-1.4-2.4z" />
    <rect x="10.9" y="8.8" width="2.2" height="6" rx="1.1" />
    <circle cx="12" cy="17.6" r="1.25" />
  </Ikon>
);
export const IkMegafon = (p) => (
  <Ikon {...p}>
    <path style={S} d="M16.2 7.6c1.9.9 3.1 2.5 3.1 4.4s-1.2 3.5-3.1 4.4z" />
    <path d="M3 10.1v3.8a1.6 1.6 0 0 0 1.6 1.6H7l7.2 4V4.5L7 8.5H4.6A1.6 1.6 0 0 0 3 10.1z" />
    <path d="M7 15.5h3l.9 4a1 1 0 0 1-1 1.2H8.7a1 1 0 0 1-1-.8z" opacity=".6" />
  </Ikon>
);
export const IkTautan = (p) => (
  <Ikon {...p}>
    <path {...garis} strokeWidth={2.3} d="M10.2 13.8a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-.9.9" />
    <path {...garis} strokeWidth={2.3} opacity=".5" d="M13.8 10.2a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l.9-.9" />
  </Ikon>
);
export const IkPesawatKertas = (p) => (
  <Ikon {...p}>
    <path style={S} d="M20.7 3.3 3.2 10.1a.8.8 0 0 0 0 1.5l6.4 2.5 2.5 6.4a.8.8 0 0 0 1.5 0z" />
    <path d="M20.7 3.3 9.65 14.1l2.5 6.4a.8.8 0 0 0 1.5.05z" />
  </Ikon>
);
export const IkPiala = (p) => (
  <Ikon {...p}>
    <path style={S} d="M8.2 15.6 6.6 21.2a.5.5 0 0 0 .75.57L12 19l4.65 2.77a.5.5 0 0 0 .75-.57l-1.6-5.6z" />
    <circle cx="12" cy="9" r="6.3" style={S} />
    <circle cx="12" cy="9" r="3.3" />
  </Ikon>
);
export const IkGrafik = (p) => (
  <Ikon {...p}>
    <rect style={S} x="3.6" y="11.6" width="4.4" height="8.6" rx="1.4" />
    <rect x="9.8" y="3.8" width="4.4" height="16.4" rx="1.4" />
    <rect style={S} x="16" y="8.4" width="4.4" height="11.8" rx="1.4" />
  </Ikon>
);
export const IkStruk = (p) => (
  <Ikon {...p}>
    <path style={S} d="M6 2.8h12a1.2 1.2 0 0 1 1.2 1.2v16.9a.4.4 0 0 1-.65.3l-2-1.5-2.1 1.6a.5.5 0 0 1-.6 0L11.7 19.7l-2.1 1.6a.5.5 0 0 1-.6 0l-2.1-1.6-1.9 1.5a.4.4 0 0 1-.65-.3V4A1.2 1.2 0 0 1 6 2.8z" />
    <rect x="8" y="7.4" width="8" height="1.7" rx=".85" />
    <rect x="8" y="11.2" width="8" height="1.7" rx=".85" />
    <rect x="8" y="15" width="4.6" height="1.7" rx=".85" />
  </Ikon>
);
export const IkLaporanBiaya = (p) => (
  <Ikon {...p}>
    <rect style={S} x="3.8" y="2.8" width="16.4" height="18.4" rx="3.2" />
    <rect x="7.4" y="12.6" width="2.6" height="5" rx="1" />
    <rect x="10.7" y="8.6" width="2.6" height="9" rx="1" />
    <rect x="14" y="10.8" width="2.6" height="6.8" rx="1" />
  </Ikon>
);
export const IkTanyaSano = (p) => (
  <Ikon {...p}>
    <path style={S} d="M4 7a3.4 3.4 0 0 1 3.4-3.4h9.2A3.4 3.4 0 0 1 20 7v7.2a3.4 3.4 0 0 1-3.4 3.4h-4.3l-3.6 3.1a.6.6 0 0 1-1-.45v-2.65A3.4 3.4 0 0 1 4 14.2z" />
    <path d="M12 6.4l1.05 2.55 2.55 1.05-2.55 1.05L12 13.6l-1.05-2.55L8.4 10l2.55-1.05z" />
  </Ikon>
);
export const IkPetir = (p) => (
  <Ikon {...p}>
    <circle style={{ opacity: 0.18 }} cx="12" cy="12" r="10" />
    <path d="M13.2 2.8 5.4 13.2a.7.7 0 0 0 .56 1.1h4.3l-.9 6.2a.5.5 0 0 0 .9.36l7.8-10.4a.7.7 0 0 0-.56-1.12h-4.3l.9-6.2a.5.5 0 0 0-.9-.34z" />
  </Ikon>
);
export const IkPengaturan = (p) => (
  <Ikon {...p}>
    <rect style={S} x="3" y="5.9" width="18" height="2.2" rx="1.1" />
    <rect style={S} x="3" y="10.9" width="18" height="2.2" rx="1.1" />
    <rect style={S} x="3" y="15.9" width="18" height="2.2" rx="1.1" />
    <circle cx="9" cy="7" r="3" />
    <circle cx="16" cy="12" r="3" />
    <circle cx="8" cy="17" r="3" />
  </Ikon>
);
// Ubin workspace (pemilih workspace) — empat kotak, dua solid dua pendukung.
export const IkRuangKerja = (p) => (
  <Ikon {...p}>
    <rect x="3.4" y="3.4" width="7.6" height="7.6" rx="2.2" />
    <rect style={S} x="13" y="3.4" width="7.6" height="7.6" rx="2.2" />
    <rect style={S} x="3.4" y="13" width="7.6" height="7.6" rx="2.2" />
    <rect x="13" y="13" width="7.6" height="7.6" rx="2.2" />
  </Ikon>
);

// Peta rute → ikon untuk sidebar Sales CRM. Rute yang tidak terdaftar memakai
// ikon aslinya (tidak ada menu yang hilang ikonnya).
export const IKON_NAV_SALES = {
  "/dashboard": IkBeranda,
  "/inbox": IkKotakMasuk,
  "/customers": IkPelangganNav,
  "/marketing/pengajuan-biaya": IkStruk,
  "/marketing/laporan-biaya": IkLaporanBiaya,
  "/pipeline": IkCorong,
  "/orders": IkPesanan,
  "/products": IkGaleri,
  "/komplain": IkKomplain,
  "/broadcast": IkMegafon,
  "/tracking": IkTautan,
  "/broadcast-sales": IkPesawatKertas,
  "/sales-intelligence": IkPiala,
  "/laporan": IkGrafik,
  "/copilot": IkTanyaSano,
  "/automation": IkPetir,
  "/pengaturan-sales": IkPengaturan,
};
