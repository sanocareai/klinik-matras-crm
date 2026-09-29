// P8.1 (UI & Navigation Consolidation) — daftar route Production/Warehouse
// LAMA yang digabung secara NAVIGASI ke menu baru (lihat docs/PRODUCTION-
// WORKSHOP-WAREHOUSE-V2-P8.1-UI-CONSOLIDATION.md §1). Kode & route aslinya
// TIDAK dihapus (pageRegistry.jsx tetap memuatnya apa adanya) — daftar ini
// cuma dipakai Layout.jsx untuk menyusun section "Legacy (Admin)" supaya
// tetap bisa dijangkau, disembunyikan dari menu operasional harian.
export const LEGACY_PRODUCTION_ROUTES = [
  { to: "/bengkel", label: "Papan Produksi (lama, V1)", replacedBy: "/bengkel/ringkasan" },
  { to: "/bengkel/planning", label: "Rencana Produksi (lama, P3)", replacedBy: "/bengkel/production-v2" },
  { to: "/bengkel/workshop", label: "Antrean Kerja (lama, P5)", replacedBy: "/produksi/meja" },
  { to: "/bengkel/work-orders", label: "Work Order (lama)", replacedBy: "/bengkel/order-produksi" },
  { to: "/bengkel/orders", label: "Semua Order (lama)", replacedBy: "/bengkel/order-produksi" },
  { to: "/bengkel/qc", label: "Inspeksi QC (lama)", replacedBy: "/bengkel/quality-control" },
  { to: "/bengkel/qc-v2", label: "Antrean QC V2 (lama)", replacedBy: "/bengkel/quality-control" },
];

export function isLegacyProductionRoute(path) {
  return LEGACY_PRODUCTION_ROUTES.some((r) => r.to === path);
}
