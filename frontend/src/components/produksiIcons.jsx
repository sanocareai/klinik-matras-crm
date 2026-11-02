import React from "react";
import {
  Box, Camera, CalendarDays, ChevronRight, CircleAlert, CircleCheck, CircleCheckBig, ClipboardList, Clock, FileText, GripVertical, Inbox, LayoutGrid, MessageCircleWarning,
  Package, RefreshCw, Receipt, Scissors, SearchCheck, Settings, ShieldCheck, Table, Target, Truck, Tv, Users, Wrench, BarChart3,
} from "lucide-react";

// Keluarga ikon workspace Produksi (Redesain tipografi + ikon, 3 Nov 2026): SATU keluarga garis rounded (lucide, sudah ada di repo; ISC) dengan bobot garis seragam.
// Sebelumnya duotone kustom dicampur dengan lucide di kontrol; kini seluruh ikon Produksi (sidebar, KPI, kontrol, panel) berasal dari keluarga yang sama.
// Nama ekspor dipertahankan supaya pemakai tidak berubah. Antarmuka sama dengan lucide (`size`, `className`); dekoratif (aria-hidden) — tombol ikon tetap wajib berlabel aksesibel di pemakainya.
const BOBOT = 1.75;
const bungkus = (Ikon) => function IkonProduksi({ size = 20, className, strokeWidth = BOBOT, ...sisa }) {
  return <Ikon size={size} strokeWidth={strokeWidth} className={className} aria-hidden="true" focusable="false" {...sisa} />;
};

export const IkRingkasanProduksi = bungkus(LayoutGrid);
export const IkOrderProduksi = bungkus(ClipboardList);
export const IkStatusProduksi = bungkus(CircleCheckBig);
export const IkRencanaProduksi = bungkus(CalendarDays);
export const IkBahanProduksi = bungkus(Box);
export const IkMeja = bungkus(Table);
export const IkCorner = bungkus(Scissors);
export const IkDokumentasi = bungkus(Camera);
export const IkQc = bungkus(ShieldCheck);
export const IkAndon = bungkus(Tv);
export const IkLaporanProduksi = bungkus(BarChart3);
export const IkBiayaProduksi = bungkus(Receipt);
export const IkKomplainProduksi = bungkus(MessageCircleWarning);
export const IkPengaturanProduksi = bungkus(Settings);

/** Target. */
export const IkTarget = bungkus(Target);
/** Selesai. */
export const IkSelesai = bungkus(CircleCheck);
/** Sedang dikerjakan. */
export const IkProses = bungkus(Wrench);
/** Menunggu. */
export const IkJam = bungkus(Clock);
/** Lewat target / peringatan. */
export const IkAwas = bungkus(CircleAlert);
/** Bahan / barang. */
export const IkKotak = bungkus(Package);
/** QC / dokumen. */
export const IkDokumen = bungkus(FileText);
/** Dalam perjalanan. */
export const IkTruk = bungkus(Truck);
/** Belum masuk papan / tiba. */
export const IkBaki = bungkus(Inbox);
/** Pemeriksaan / uji. */
export const IkPeriksa = bungkus(SearchCheck);
/** Jadwal. */
export const IkJadwal = bungkus(CalendarDays);
/** Pekerjaan PIC. */
export const IkOrang = bungkus(Users);
/** Muat ulang. */
export const IkMuatUlang = bungkus(RefreshCw);
/** Panah kanan kecil. */
export const IkPanahKanan = bungkus(ChevronRight);
/** Handle seret. */
export const IkGrip = bungkus(GripVertical);

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
