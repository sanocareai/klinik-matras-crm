import React from "react";

// Keluarga ikon workspace Produksi (redesign Produksi, 2 Nov 2026): duotone SVG 24x24 yang SAMA dengan sanssIcons/financeIcons —
// bentuk utama solid, pendukung 35%, currentColor (biru saat diam, putih di atas pill aktif). Antarmuka sama dengan ikon lucide
// (`size`, `className`) sehingga dipasang tanpa mengubah komponen menu. Berkas terpisah agar tidak berbenturan dengan sesi lain.
function Ikon({ size = 20, className, children }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}
const S = { opacity: 0.35 };
const garis = { fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round" };

/** Empat petak: ringkasan. */
export const IkRingkasanProduksi = (p) => (
  <Ikon {...p}>
    <rect style={S} x="3" y="3" width="8.4" height="8.4" rx="2.4" />
    <rect x="12.6" y="3" width="8.4" height="5.4" rx="2.2" />
    <rect x="12.6" y="9.6" width="8.4" height="11.4" rx="2.4" />
    <rect style={S} x="3" y="12.6" width="8.4" height="8.4" rx="2.4" />
  </Ikon>
);

/** Dokumen dengan baris: order produksi. */
export const IkOrderProduksi = (p) => (
  <Ikon {...p}>
    <path style={S} d="M6.2 2.8h8.2l4.6 4.6v11a2.8 2.8 0 0 1-2.8 2.8H6.2a2.8 2.8 0 0 1-2.8-2.8V5.6a2.8 2.8 0 0 1 2.8-2.8z" />
    <path d="M14.4 2.8 19 7.4h-3.2a1.4 1.4 0 0 1-1.4-1.4z" />
    <rect x="7.2" y="11.4" width="9.6" height="1.8" rx=".9" />
    <rect x="7.2" y="15.2" width="6" height="1.8" rx=".9" />
  </Ikon>
);

/** Kalender dengan jam: status produksi. */
export const IkStatusProduksi = (p) => (
  <Ikon {...p}>
    <rect style={S} x="3" y="4.6" width="18" height="16.4" rx="4" />
    <rect x="7.4" y="2.6" width="2" height="4" rx="1" />
    <rect x="14.6" y="2.6" width="2" height="4" rx="1" />
    <circle cx="12" cy="14" r="4" />
    <path {...garis} stroke="#fff" strokeWidth="1.6" d="M12 12v2.2l1.4.9" />
  </Ikon>
);

/** Kalender dengan tanda: rencana produksi. */
export const IkRencanaProduksi = (p) => (
  <Ikon {...p}>
    <rect style={S} x="3" y="4.6" width="18" height="16.4" rx="4" />
    <rect x="7.4" y="2.6" width="2" height="4" rx="1" />
    <rect x="14.6" y="2.6" width="2" height="4" rx="1" />
    <rect x="7" y="11" width="3.2" height="3.2" rx="1" />
    <rect x="13.8" y="11" width="3.2" height="3.2" rx="1" />
    <rect x="7" y="15.6" width="3.2" height="2.6" rx="1" />
  </Ikon>
);

/** Kotak bahan dengan panah keluar: bahan produksi. */
export const IkBahanProduksi = (p) => (
  <Ikon {...p}>
    <path style={S} d="M12 2.8 20 7v10l-8 4.2L4 17V7z" />
    <path d="M12 2.8 20 7l-8 4.2L4 7z" />
    <path {...garis} stroke="#fff" strokeWidth="1.6" d="M12 12.6v6" />
  </Ikon>
);

/** Meja kerja: mode Meja. */
export const IkMeja = (p) => (
  <Ikon {...p}>
    <rect style={S} x="2.8" y="6.4" width="18.4" height="5.6" rx="2.2" />
    <rect x="4.6" y="12" width="2.4" height="7.6" rx="1.1" />
    <rect x="17" y="12" width="2.4" height="7.6" rx="1.1" />
    <rect x="3.6" y="4.6" width="16.8" height="3.4" rx="1.7" />
  </Ikon>
);

/** Sudut kerja dengan gunting: mode Corner. */
export const IkCorner = (p) => (
  <Ikon {...p}>
    <path style={S} d="M4 4h8.4a2.6 2.6 0 0 1 2.6 2.6V20H6.6A2.6 2.6 0 0 1 4 17.4z" />
    <path {...garis} d="M10.6 11.4 20 17.8M10.6 17.8 20 11.4" />
    <circle cx="9.4" cy="10.6" r="1.7" />
    <circle cx="9.4" cy="18.6" r="1.7" />
  </Ikon>
);

/** Kamera: dokumentasi. */
export const IkDokumentasi = (p) => (
  <Ikon {...p}>
    <path style={S} d="M8.4 5.2 9.4 3.6a1.4 1.4 0 0 1 1.2-.6h2.8a1.4 1.4 0 0 1 1.2.6l1 1.6H18a3 3 0 0 1 3 3V17a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V8.2a3 3 0 0 1 3-3z" />
    <circle cx="12" cy="12.4" r="3.9" />
    <circle cx="12" cy="12.4" r="1.7" fill="#fff" opacity=".7" />
  </Ikon>
);

/** Perisai dengan centang: QC. */
export const IkQc = (p) => (
  <Ikon {...p}>
    <path style={S} d="M12 2.6 19.6 5.4v6.2c0 4.4-3 7.8-7.6 9.8-4.6-2-7.6-5.4-7.6-9.8V5.4z" />
    <path {...garis} strokeWidth="2.1" d="m8.6 12.2 2.4 2.4 4.6-4.8" />
  </Ikon>
);

/** Layar TV: Andon. */
export const IkAndon = (p) => (
  <Ikon {...p}>
    <rect style={S} x="2.6" y="3.8" width="18.8" height="12.8" rx="3.4" />
    <rect x="8" y="18.2" width="8" height="2" rx="1" />
    <rect x="11" y="16" width="2" height="2.6" />
    <rect x="6.4" y="7.4" width="6.6" height="1.8" rx=".9" />
    <rect x="6.4" y="10.8" width="3.8" height="1.8" rx=".9" />
  </Ikon>
);

/** Grafik batang: KPI & laporan. */
export const IkLaporanProduksi = (p) => (
  <Ikon {...p}>
    <rect style={S} x="3" y="3" width="18" height="18" rx="4.6" />
    <rect x="7" y="12.4" width="2.4" height="4.8" rx="1" />
    <rect x="10.8" y="8.4" width="2.4" height="8.8" rx="1" />
    <rect x="14.6" y="10.6" width="2.4" height="6.6" rx="1" />
  </Ikon>
);

/** Struk dengan koin: biaya produksi. */
export const IkBiayaProduksi = (p) => (
  <Ikon {...p}>
    <path style={S} d="M5.6 2.8h12.8a1.4 1.4 0 0 1 1.4 1.4v16.6l-2.6-1.6-2.4 1.6-2.4-1.6-2.4 1.6-2.4-1.6-2.6 1.6V4.2a1.4 1.4 0 0 1 1.4-1.4z" />
    <circle cx="12" cy="10.4" r="3.4" />
    <path {...garis} stroke="#fff" strokeWidth="1.5" d="M12 8.8v3.2" />
  </Ikon>
);

/** Gelembung dengan tanda seru: komplain & revisi. */
export const IkKomplainProduksi = (p) => (
  <Ikon {...p}>
    <path style={S} d="M5.6 3.6h12.8a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-4.6L8.6 21v-3.4H5.6a3 3 0 0 1-3-3v-8a3 3 0 0 1 3-3z" />
    <rect x="11" y="7.2" width="2" height="5" rx="1" />
    <circle cx="12" cy="14.8" r="1.15" />
  </Ikon>
);

/** Roda gigi: pengaturan. */
export const IkPengaturanProduksi = (p) => (
  <Ikon {...p}>
    <circle style={S} cx="12" cy="12" r="6.6" />
    <path {...garis} strokeWidth="2.4" d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7" />
    <circle cx="12" cy="12" r="3" />
  </Ikon>
);


/* ── Ikon isi halaman (KPI, status, aksi) — keluarga yang sama ───────────── */
/** Target dengan anak panah. */
export const IkTarget = (p) => (<Ikon {...p}><circle style={S} cx="12" cy="12" r="9.2" /><circle cx="12" cy="12" r="5.2" /><circle cx="12" cy="12" r="2" fill="#fff" opacity=".85" /></Ikon>);
/** Lingkaran dengan centang: selesai. */
export const IkSelesai = (p) => (<Ikon {...p}><circle style={S} cx="12" cy="12" r="9.4" /><path {...garis} strokeWidth="2.2" d="m7.8 12.3 2.8 2.8 5.6-5.8" /></Ikon>);
/** Roda gigi isi: sedang dikerjakan. */
export const IkProses = (p) => (<Ikon {...p}><circle style={S} cx="12" cy="12" r="7.4" /><path {...garis} strokeWidth="2.6" d="M12 2.8v2.2M12 19v2.2M2.8 12H5M19 12h2.2M5.5 5.5l1.6 1.6M16.9 16.9l1.6 1.6M5.5 18.5l1.6-1.6M16.9 7.1l1.6-1.6" /><circle cx="12" cy="12" r="3.4" /></Ikon>);
/** Jam: menunggu. */
export const IkJam = (p) => (<Ikon {...p}><circle style={S} cx="12" cy="12" r="9.4" /><path {...garis} strokeWidth="2.1" d="M12 6.8V12l3.4 2" /></Ikon>);
/** Lingkaran tanda seru: lewat target / peringatan. */
export const IkAwas = (p) => (<Ikon {...p}><circle style={S} cx="12" cy="12" r="9.4" /><rect x="10.9" y="6.6" width="2.2" height="6.4" rx="1.1" /><circle cx="12" cy="16.2" r="1.3" /></Ikon>);
/** Kotak: bahan / barang. */
export const IkKotak = (p) => (<Ikon {...p}><path style={S} d="M12 2.8 20 7v10l-8 4.2L4 17V7z" /><path d="M12 2.8 20 7l-8 4.2L4 7z" /><path {...garis} stroke="#fff" strokeWidth="1.6" d="M12 12.4v6.6" /></Ikon>);
/** Dokumen dengan baris: QC / dokumen. */
export const IkDokumen = (p) => (<Ikon {...p}><path style={S} d="M6.2 2.8h8.2l4.6 4.6v11a2.8 2.8 0 0 1-2.8 2.8H6.2a2.8 2.8 0 0 1-2.8-2.8V5.6a2.8 2.8 0 0 1 2.8-2.8z" /><rect x="7.2" y="11" width="9.6" height="1.8" rx=".9" /><rect x="7.2" y="14.8" width="6" height="1.8" rx=".9" /></Ikon>);
/** Truk: dalam perjalanan. */
export const IkTruk = (p) => (<Ikon {...p}><rect style={S} x="2.6" y="5.4" width="11.4" height="10.2" rx="2.6" /><path d="M14 8.6h3.6l3 3.6v3.4a1.4 1.4 0 0 1-1.4 1.4H14z" /><circle cx="7.4" cy="17.6" r="2.2" /><circle cx="17" cy="17.6" r="2.2" /></Ikon>);
/** Baki masuk: belum masuk papan / tiba. */
export const IkBaki = (p) => (<Ikon {...p}><path style={S} d="M3 12.4 5.6 5.6A2.6 2.6 0 0 1 8 4h8a2.6 2.6 0 0 1 2.4 1.6L21 12.4V17a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z" /><path d="M3 12.4h5.2a1.6 1.6 0 0 1 1.4 1l.4.8a1.6 1.6 0 0 0 1.4 1h1.2a1.6 1.6 0 0 0 1.4-1l.4-.8a1.6 1.6 0 0 1 1.4-1H21V17a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z" /></Ikon>);
/** Kaca pembesar: pemeriksaan / uji. */
export const IkPeriksa = (p) => (<Ikon {...p}><circle style={S} cx="10.6" cy="10.6" r="7.4" /><path {...garis} strokeWidth="2.4" d="m16.2 16.2 4.4 4.4" /><circle cx="10.6" cy="10.6" r="3" /></Ikon>);
/** Kalender: jadwal. */
export const IkJadwal = (p) => (<Ikon {...p}><rect style={S} x="3" y="4.6" width="18" height="16.4" rx="4" /><rect x="7.4" y="2.6" width="2" height="4" rx="1" /><rect x="14.6" y="2.6" width="2" height="4" rx="1" /><rect x="7" y="11" width="3.2" height="3.2" rx="1" /><rect x="13.8" y="11" width="3.2" height="3.2" rx="1" /></Ikon>);
/** Dua orang: pekerjaan PIC. */
export const IkOrang = (p) => (<Ikon {...p}><circle style={S} cx="9" cy="8.4" r="3.6" /><path style={S} d="M2.6 19.4a6.4 6.4 0 0 1 12.8 0z" /><circle cx="17" cy="9.2" r="2.8" /><path d="M13.6 19.4a5 5 0 0 1 8 -3.9v3.9z" /></Ikon>);
/** Panah muat ulang. */
export const IkMuatUlang = (p) => (<Ikon {...p}><path style={S} d="M20.2 12a8.2 8.2 0 1 1-2.6-6" /><path {...garis} strokeWidth="2.2" d="M20 4v4.6h-4.6" /></Ikon>);
/** Panah kanan kecil. */
export const IkPanahKanan = (p) => (<Ikon {...p}><path {...garis} strokeWidth="2.2" d="m9.4 5.6 6.4 6.4-6.4 6.4" /></Ikon>);

/** Ikon sidebar per RUTE (Layout.jsx memetakan saat render; data menu tidak berubah). */
export const IKON_NAV_PRODUKSI = {
  "/bengkel/ringkasan": IkRingkasanProduksi,
  "/bengkel/order-produksi": IkOrderProduksi,
  "/bengkel/production-v2": IkStatusProduksi,
  "/bengkel/rencana-produksi": IkRencanaProduksi,
  "/bengkel/materials": IkBahanProduksi,
  "/produksi/meja": IkMeja,
  "/produksi/corner": IkCorner,
  "/produksi/dokumentasi": IkDokumentasi,
  "/produksi/qc": IkQc,
  "/bengkel/andon": IkAndon,
  "/bengkel/kpi": IkLaporanProduksi,
  "/bengkel/biaya-produksi": IkBiayaProduksi,
  "/bengkel/komplain-revisi": IkKomplainProduksi,
  "/bengkel/pengaturan": IkPengaturanProduksi,
};
