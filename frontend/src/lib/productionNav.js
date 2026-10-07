// P12B.2 — struktur sidebar Production (SATU sumber kebenaran, murni data tanpa JSX supaya bisa diuji `node --test`).
// Layout.jsx memetakan `icon` (nama lucide) ke komponen ikon. Visibilitas per peran memakai filterMenuByPermission/visibleSections
// (lib/menuVisibility.js). Server tetap penegak izin sebenarnya — di sini hanya menyembunyikan menu yang pasti buntu.
export const PRODUCTION_SETTINGS_ROLES = Object.freeze(["ADMIN", "OWNER", "PRODUCTION_LEAD"]);
export const PRODUCTION_KPI_ROLES = Object.freeze(["ADMIN", "OWNER", "PRODUCTION_LEAD"]);
export const PRODUCTION_QC_APP_ROLES = Object.freeze(["ADMIN", "OWNER", "QC_LEAD"]);

export const PRODUCTION_NAV = Object.freeze([
  {
    section: "OPERASIONAL",
    items: [
      { to: "/bengkel/ringkasan", label: "Ringkasan", icon: "Gauge" },
      { to: "/bengkel/order-produksi", label: "Order Produksi", icon: "Boxes" },
      { to: "/bengkel/production-v2", label: "Status Produksi", icon: "CalendarClock" },
      { to: "/bengkel/rencana-produksi", label: "Rencana Produksi", icon: "ClipboardList" },
      // Antrean pengujian awal PIC QC (Fase 2 LAYANAN) — terlihat langsung di OPERASIONAL (bukan di akordeon tertutup) untuk pemegang izin QC; berdiri sendiri, tidak bergantung pada menu QC desktop yang disembunyikan. Server menegakkan izin tulis.
      { to: "/produksi/qc", label: "Antrean PIC QC", icon: "ClipboardCheck", bolehPeran: PRODUCTION_QC_APP_ROLES },
      // Menu Quality Control DISEMBUNYIKAN sementara (simplifikasi slice 1; gerbang lifecycle QC diubah di slice 2). Halaman & rute tetap ada (tautan lama/bookmark tidak patah).
      { to: "/bengkel/materials", label: "Bahan Produksi", icon: "ArrowUpFromLine" },
    ],
  },
  {
    // Mode kerja = perangkat/aplikasi lantai (halaman mandiri). Akordeon, DEFAULT TERTUTUP kecuali salah satu anaknya aktif.
    section: "MODE KERJA",
    collapsible: true,
    defaultClosed: true,
    items: [
      { to: "/produksi/meja", label: "Aplikasi Meja", icon: "Wrench" },
      { to: "/produksi/corner", label: "Aplikasi Corner", icon: "Scissors" },
      { to: "/produksi/dokumentasi", label: "Aplikasi Dokumentasi", icon: "Camera" },
      { to: "/bengkel/andon", label: "Andon TV", icon: "Tv" },
    ],
  },
  {
    section: "KONTROL & LAPORAN",
    items: [
      { to: "/bengkel/kpi", label: "KPI & Laporan", icon: "BarChart3", bolehPeran: PRODUCTION_KPI_ROLES },
      // C1 — biaya operasional NON-STOK; hanya PRODUCTION_LEAD/Finance/Admin (+ anggota divisi PRODUCTION); server menegakkan ulang.
      { to: "/bengkel/biaya-produksi", label: "Biaya Produksi", icon: "Receipt", bolehPeran: ["ADMIN", "OWNER", "FINANCE", "APPROVER", "PRODUCTION_LEAD"], bolehDivisi: ["PRODUCTION"] },
      { to: "/bengkel/komplain-revisi", label: "Komplain & Revisi", icon: "AlertTriangle" },
    ],
  },
  {
    section: "ADMINISTRASI",
    pinBottom: true, // Pengaturan selalu di dasar kolom menu
    items: [
      { to: "/bengkel/pengaturan", label: "Pengaturan", icon: "Settings", bolehPeran: PRODUCTION_SETTINGS_ROLES },
    ],
  },
]);

// Section akordeon: terbuka bila ditandai pengguna (toggled) ATAU salah satu anaknya sedang aktif; selain itu mengikuti default-nya.
export function sectionIsOpen(section, { toggled = false, activeTo = null } = {}) {
  if (!section.collapsible) return true;
  const childActive = !!activeTo && section.items.some((i) => i.to.split("?")[0] === activeTo);
  const base = section.defaultClosed ? childActive : true;
  return toggled ? !base : base;
}
