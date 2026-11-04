import React from "react";

// Keluarga ikon workspace Gudang (redesain Gudang, 3 Nov 2026): SATU keluarga SVG garis 24x24 — goresan 1.7, ujung dan sambungan membulat, tanpa isian,
// `currentColor` (biru saat diam, putih di atas pill aktif). Bentuk sederhana ala simbol sistem; tiap ikon memakai kosakata yang sama (kotak, panah, garis).
// Antarmuka sama dengan ikon lucide (`size`, `className`) sehingga dipasang tanpa mengubah komponen menu. Berkas terpisah agar tidak berbenturan dengan sesi lain.
function Ikon({ size = 20, className, children, tebal = 1.7 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={tebal} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

/** Rumah: Beranda. */
export const IkBeranda = (p) => (<Ikon {...p}><path d="M4 10.6 12 4l8 6.6" /><path d="M6 9.4V19a1 1 0 0 0 1 1h3.4v-5.2h3.2V20H17a1 1 0 0 0 1-1V9.4" /></Ikon>);
/** Truk: Barang akan datang. */
export const IkTruk = (p) => (<Ikon {...p}><path d="M3 6.6A1.6 1.6 0 0 1 4.6 5H13v10H3z" /><path d="M13 8.6h3.8L20 12v3h-7" /><circle cx="7.2" cy="16.6" r="1.9" /><circle cx="16.4" cy="16.6" r="1.9" /></Ikon>);
/** Kotak: bahan / penerimaan barang. */
export const IkKotak = (p) => (<Ikon {...p}><path d="M12 3.4 20 7.6v8.8l-8 4.2-8-4.2V7.6z" /><path d="m4.2 7.8 7.8 4.1 7.8-4.1" /><path d="M12 12v8.4" /></Ikon>);
/** Panah balik: retur. */
export const IkRetur = (p) => (<Ikon {...p}><path d="M9 6 4.6 10.4 9 14.8" /><path d="M5 10.4h9.4a5 5 0 0 1 0 10H11" /></Ikon>);
/** Rak tiga tingkat: stok & lokasi. */
export const IkStok = (p) => (<Ikon {...p}><rect x="3.6" y="3.6" width="16.8" height="16.8" rx="3" /><path d="M3.8 9.4h16.4M3.8 14.8h16.4" /><path d="M9 9.4V3.8M15 14.8V9.4M9 20.2v-5.4" /></Ikon>);
/** Dokumen dengan panah keluar: pengeluaran material. */
export const IkKeluar = (p) => (<Ikon {...p}><path d="M13.6 3.6H7.4a2 2 0 0 0-2 2v12.8a2 2 0 0 0 2 2h9.2a2 2 0 0 0 2-2V8.6z" /><path d="M13.4 3.8v4.6a.6.6 0 0 0 .6.6h4.4" /><path d="M9 14.6h6M12.4 11.8l2.8 2.8-2.8 2.8" /></Ikon>);
/** Dua panah berlawanan: transfer. */
export const IkTransfer = (p) => (<Ikon {...p}><path d="M5 8.4h14M15.6 5l3.4 3.4-3.4 3.4" /><path d="M19 15.6H5M8.4 12.2 5 15.6l3.4 3.4" /></Ikon>);
/** Panah melingkar: restok. */
export const IkRestok = (p) => (<Ikon {...p}><path d="M19.6 12a7.6 7.6 0 0 1-13 5.4" /><path d="M4.4 12a7.6 7.6 0 0 1 13-5.4" /><path d="M17.8 3.6v3.2h-3.2M6.2 20.4v-3.2h3.2" /></Ikon>);
/** Papan klip dengan centang: antrean produksi. */
export const IkAntrean = (p) => (<Ikon {...p}><rect x="5" y="4.6" width="14" height="16" rx="2.6" /><path d="M9.4 4.6V4a1 1 0 0 1 1-1h3.2a1 1 0 0 1 1 1v.6" /><path d="m8.8 13.2 2.2 2.2 4.2-4.4" /></Ikon>);
/** Kotak dengan panah masuk: penerimaan unit / barang jadi. */
export const IkTerima = (p) => (<Ikon {...p}><path d="M12 3.6v9.6M8.4 9.8l3.6 3.6 3.6-3.6" /><path d="M4 14v3.4A2.6 2.6 0 0 0 6.6 20h10.8a2.6 2.6 0 0 0 2.6-2.6V14" /></Ikon>);
/** Segitiga seru: perlu perhatian. */
export const IkAwas = (p) => (<Ikon {...p}><path d="M10.6 4.8 3.8 16.6a1.6 1.6 0 0 0 1.4 2.4h13.6a1.6 1.6 0 0 0 1.4-2.4L13.4 4.8a1.6 1.6 0 0 0-2.8 0z" /><path d="M12 10v3.6" /><circle cx="12" cy="16.2" r=".5" fill="currentColor" /></Ikon>);
/** Timbangan: opname. */
export const IkOpname = (p) => (<Ikon {...p}><path d="M12 4v16M8 20h8" /><path d="M5 7.4h14" /><path d="m5 7.4-2.4 6a2.6 2.6 0 0 0 4.8 0zM19 7.4l-2.4 6a2.6 2.6 0 0 0 4.8 0z" /></Ikon>);
/** Kotak retak: barang rusak. */
export const IkRusak = (p) => (<Ikon {...p}><path d="M12 3.4 20 7.6v8.8l-8 4.2-8-4.2V7.6z" /><path d="m12 3.8 1.6 4.4-3 2.4 2.6 2.6-1.4 4.4" /></Ikon>);
/** Struk: pengajuan biaya. */
export const IkStruk = (p) => (<Ikon {...p}><path d="M6 3.6h12v16.8l-2.4-1.6-1.8 1.6-1.8-1.6-1.8 1.6-1.8-1.6L6 20.4z" /><path d="M9.2 8.6h5.6M9.2 12.2h5.6" /></Ikon>);
/** Batang: laporan. */
export const IkLaporan = (p) => (<Ikon {...p}><path d="M5 20V10.6M12 20V4.6M19 20v-7.6" /><path d="M3.4 20.2h17.2" /></Ikon>);
/** Jam putar: riwayat. */
export const IkRiwayat = (p) => (<Ikon {...p}><path d="M3.8 12a8.2 8.2 0 1 0 2.5-5.9" /><path d="M3.6 4.4v3.8h3.8" /><path d="M12 7.8V12l2.8 1.8" /></Ikon>);
/** Busur ukur: KPI. */
export const IkKpi = (p) => (<Ikon {...p}><path d="M4.4 17.6a8.2 8.2 0 1 1 15.2 0" /><path d="m12 13 3.2-4.4" /><circle cx="12" cy="13.4" r="1.2" /></Ikon>);
/** Perisai centang: kontrol. */
export const IkKontrol = (p) => (<Ikon {...p}><path d="M12 3.4 19.4 6v5.6c0 4.4-3 7.6-7.4 9-4.4-1.4-7.4-4.6-7.4-9V6z" /><path d="m8.8 12.2 2.4 2.4 4.2-4.6" /></Ikon>);
/** Roda gigi: produksi. */
export const IkProduksi = (p) => (<Ikon {...p}><circle cx="12" cy="12" r="3.2" /><path d="M12 3.4v2.2M12 18.4v2.2M3.4 12h2.2M18.4 12h2.2M5.9 5.9l1.6 1.6M16.5 16.5l1.6 1.6M5.9 18.1l1.6-1.6M16.5 7.5l1.6-1.6" /></Ikon>);
/** Tray masuk: grup Penerimaan. */
export const IkNampan = (p) => (<Ikon {...p}><path d="M4 13.4 6.2 5.8a1.6 1.6 0 0 1 1.5-1.2h8.6a1.6 1.6 0 0 1 1.5 1.2L20 13.4" /><path d="M4 13.4V18a1.6 1.6 0 0 0 1.6 1.6h12.8A1.6 1.6 0 0 0 20 18v-4.6h-4.4a1.4 1.4 0 0 0-1.3 1l-.1.3a1.4 1.4 0 0 1-1.3 1h-1.8a1.4 1.4 0 0 1-1.3-1l-.1-.3a1.4 1.4 0 0 0-1.3-1z" /></Ikon>);
/** Gedung gudang: ikon ruang kerja. */
export const IkGudang = (p) => (<Ikon {...p}><path d="M3.6 9.6 12 4l8.4 5.6V20H3.6z" /><path d="M8 20v-6.4h8V20M8 16.8h8" /></Ikon>);

// Ikon kecil untuk isi halaman (satu keluarga yang sama).
export const IkCari = (p) => (<Ikon {...p}><circle cx="11" cy="11" r="6.6" /><path d="m16 16 4 4" /></Ikon>);
export const IkTambah = (p) => (<Ikon {...p} tebal={2}><path d="M12 5v14M5 12h14" /></Ikon>);
export const IkMuatUlang = (p) => (<Ikon {...p}><path d="M19.6 12a7.6 7.6 0 1 1-2.4-5.5" /><path d="M19.6 4.6v4.2h-4.2" /></Ikon>);
export const IkKalender = (p) => (<Ikon {...p}><rect x="3.6" y="5" width="16.8" height="15.4" rx="3" /><path d="M3.8 10h16.4M8 3.4v3.2M16 3.4v3.2" /></Ikon>);
export const IkDokumen = (p) => (<Ikon {...p}><path d="M13.6 3.6H7.4a2 2 0 0 0-2 2v12.8a2 2 0 0 0 2 2h9.2a2 2 0 0 0 2-2V8.6z" /><path d="M13.4 3.8v4.6a.6.6 0 0 0 .6.6h4.4M9 13h6M9 16.4h4" /></Ikon>);
export const IkJam = (p) => (<Ikon {...p}><circle cx="12" cy="12" r="8.4" /><path d="M12 7.6V12l3 1.8" /></Ikon>);
export const IkInfo = (p) => (<Ikon {...p}><circle cx="12" cy="12" r="8.4" /><path d="M12 11v5" /><circle cx="12" cy="8" r=".5" fill="currentColor" /></Ikon>);
export const IkCentang = (p) => (<Ikon {...p} tebal={2.2}><path d="m5.6 12.6 4.2 4.2 8.6-9" /></Ikon>);
export const IkTutup = (p) => (<Ikon {...p} tebal={2}><path d="M6.4 6.4l11.2 11.2M17.6 6.4 6.4 17.6" /></Ikon>);
export const IkPanah = (p) => (<Ikon {...p} tebal={2}><path d="m9.4 5.6 6.4 6.4-6.4 6.4" /></Ikon>);
export const IkBawah = (p) => (<Ikon {...p} tebal={2}><path d="m5.6 9.4 6.4 6.4 6.4-6.4" /></Ikon>);
export const IkTautan = (p) => (<Ikon {...p}><path d="M9 5.6H6.6a2 2 0 0 0-2 2v9.8a2 2 0 0 0 2 2h9.8a2 2 0 0 0 2-2V15" /><path d="M13 4.6h6.4V11M19.2 4.8 11 13" /></Ikon>);
export const IkSaring = (p) => (<Ikon {...p}><path d="M4 6h16M7 12h10M10 18h4" /></Ikon>);

/** Menu sidebar Gudang menurut RUTE (sumber data menu, urutan, badge, dan izin tidak tersentuh). */
export const IKON_NAV_GUDANG = {
  "/warehouse/dashboard": IkBeranda,
  "/warehouse/barang-akan-datang": IkTruk,
  "/warehouse/goods-receipt": IkKotak,
  "/warehouse/retur-supplier": IkRetur,
  "/warehouse/inventory": IkStok,
  "/warehouse/usulan-bahan": IkDokumen,
  "/warehouse/material-issue": IkKeluar,
  "/warehouse/transfers": IkTransfer,
  "/warehouse/replenishment": IkRestok,
  "/warehouse/antrean-produksi": IkAntrean,
  "/warehouse/unit-custody": IkTerima,
  "/warehouse/material-pickup": IkKeluar,
  "/warehouse/finished-goods": IkTerima,
  "/warehouse/perlu-perhatian": IkAwas,
  "/warehouse/stock-count": IkOpname,
  "/warehouse/posting-historis": IkRiwayat,
  "/warehouse/adjustments": IkRusak,
  "/komplain": IkAwas,
  "/warehouse/pengajuan-biaya": IkStruk,
  "/warehouse/laporan-biaya": IkLaporan,
  "/finance/persediaan-awal": IkOpname,
  "/warehouse/reports": IkRiwayat,
  "/warehouse/nilai-persediaan": IkLaporan,
  "/warehouse/kpi": IkKpi,
};

/** Ikon kelompok sidebar menurut NAMA kelompok. */
export const IKON_GRUP_GUDANG = {
  Beranda: IkBeranda,
  Penerimaan: IkNampan,
  Stok: IkKotak,
  Produksi: IkProduksi,
  Kontrol: IkKontrol,
  Laporan: IkLaporan,
};

// Ikon aksi dokumen (panel tindakan Gudang).
export const IkEdit = (p) => (<Ikon {...p}><path d="M4 20h4.2L19 9.2a2.2 2.2 0 0 0 0-3.1l-1.1-1.1a2.2 2.2 0 0 0-3.1 0L4 15.8z" /><path d="m13.2 6.6 4.2 4.2" /></Ikon>);
export const IkBatal = (p) => (<Ikon {...p}><circle cx="12" cy="12" r="8.4" /><path d="m6.2 6.2 11.6 11.6" /></Ikon>);
export const IkKembali = (p) => (<Ikon {...p}><path d="M9 6 4.6 10.4 9 14.8" /><path d="M5 10.4h8.4a5.6 5.6 0 0 1 0 11.2H10" /></Ikon>);
export const IkSimpan = (p) => (<Ikon {...p}><path d="M5 4h11l3 3v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z" /><path d="M8 4v5h7V4M8 20v-6h8v6" /></Ikon>);
export const IkKoreksi = (p) => (<Ikon {...p}><path d="M13.6 3.6H7.4a2 2 0 0 0-2 2v12.8a2 2 0 0 0 2 2h9.2a2 2 0 0 0 2-2V8.6z" /><path d="M13.4 3.8v4.6a.6.6 0 0 0 .6.6h4.4" /><path d="m9 15 2 2 4-4.4" /></Ikon>);
export const IkFoto = (p) => (<Ikon {...p}><path d="M4 8.4A2.4 2.4 0 0 1 6.4 6h1.2l1.3-2h6.2l1.3 2h1.2A2.4 2.4 0 0 1 20 8.4v8.2A2.4 2.4 0 0 1 17.6 19H6.4A2.4 2.4 0 0 1 4 16.6z" /><circle cx="12" cy="12.6" r="3.3" /></Ikon>);
export const IkSampah = (p) => (<Ikon {...p}><path d="M5 7h14M10 7V5h4v2M7 7l.8 12a1 1 0 0 0 1 .9h6.4a1 1 0 0 0 1-.9L17 7M10 11v5M14 11v5" /></Ikon>);
export const IkKunci = (p) => (<Ikon {...p}><rect x="5" y="10.4" width="14" height="9.6" rx="2.6" /><path d="M8.4 10.4V8a3.6 3.6 0 0 1 7.2 0v2.4" /></Ikon>);

// Ikon kelompok bahan (Stok & Lokasi) — keluarga garis yang sama; kelompok dari server (tabel eksplisit), ikon tidak menebak dari nama.
export const IkLapis = (p) => (<Ikon {...p}><path d="m12 4 8 4.2-8 4.2L4 8.2z" /><path d="m4 12.2 8 4.2 8-4.2M4 16.2l8 4.2 8-4.2" /></Ikon>);
export const IkGunting = (p) => (<Ikon {...p}><circle cx="6.6" cy="7" r="2.4" /><circle cx="6.6" cy="17" r="2.4" /><path d="m8.5 8.5 11 8M8.5 15.5l11-8" /></Ikon>);
export const IkBenang = (p) => (<Ikon {...p}><circle cx="12" cy="12" r="8" /><path d="M7 8.6c3 .8 7 .8 10 0M6.2 12.4c3.6 1 7.8 1 11.6 0M7 16.2c3 .8 7 .8 10 0" /></Ikon>);
export const IkPegas = (p) => (<Ikon {...p}><path d="M7 4h10M7 20h10M8 4c6 1.2 6 3 0 4.2s-6 3 0 4.2 6 3 0 4.2" /></Ikon>);
export const IkKayu = (p) => (<Ikon {...p}><path d="M12 3.4 7 10h3l-4 6h4.4V20h3.2v-4H18l-4-6h3z" /></Ikon>);
export const IkTetes = (p) => (<Ikon {...p}><path d="M12 3.6c3.6 4 6 6.8 6 10a6 6 0 0 1-12 0c0-3.2 2.4-6 6-10z" /><path d="M9.4 14.4a2.8 2.8 0 0 0 2.4 2.4" /></Ikon>);
export const IkPerkakas = (p) => (<Ikon {...p}><path d="M14.4 5.4a4 4 0 0 0-5 5L4 16l4 4 5.6-5.4a4 4 0 0 0 5-5l-2.6 2.6-2.6-.6-.6-2.6z" /></Ikon>);
export const IkTanya = (p) => (<Ikon {...p}><circle cx="12" cy="12" r="8.4" /><path d="M9.6 9.4a2.5 2.5 0 0 1 4.8.8c0 1.6-2.4 2-2.4 3.4" /><circle cx="12" cy="16.6" r=".5" fill="currentColor" /></Ikon>);
export const IkLokasi = (p) => (<Ikon {...p}><path d="M12 20.4s6-5.2 6-10.2a6 6 0 0 0-12 0c0 5 6 10.2 6 10.2z" /><circle cx="12" cy="10.2" r="2.2" /></Ikon>);
export const IkHarga = (p) => (<Ikon {...p}><path d="M4 12.4V5.2A1.2 1.2 0 0 1 5.2 4h7.2l7.4 7.4a1.6 1.6 0 0 1 0 2.2l-6.2 6.2a1.6 1.6 0 0 1-2.2 0z" /><circle cx="8.6" cy="8.6" r="1.2" /></Ikon>);
export const IkTimbang = IkOpname;

/** Dua kotak bertumpuk: salin kode. */
export const IkSalin = (p) => (<Ikon {...p}><rect x="8.6" y="8.6" width="11" height="11" rx="2.4" /><path d="M15.4 8.6V6.8a2.2 2.2 0 0 0-2.2-2.2H6.8a2.2 2.2 0 0 0-2.2 2.2v6.4a2.2 2.2 0 0 0 2.2 2.2h1.8" /></Ikon>);
