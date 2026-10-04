import React, { lazy } from "react";
import { matchPath } from "react-router-dom";
import { rolesOf } from "../lib/roles.js";
import { splitPathQuery } from "../lib/splitPathQuery.js";
import { tabPathFor } from "../lib/legacyProductionRoutes.js";
import { DemoPage } from "../features/production/demo/DemoControls.jsx";

// D-143 (9 September 2026) — SATU SUMBER KEBENARAN untuk daftar halaman.
// Sebelumnya seluruh ~55 lazy import + <Route> ditulis langsung di App.jsx.
// Dipindah ke sini (refactor MURNI, tanpa mengubah path/props/perilaku apa
// pun) supaya array yang sama bisa dipakai App.jsx (untuk <Routes> seperti
// biasa) MAUPUN sistem tab dalam-app (untuk mencocokkan sebuah path ke
// komponen halamannya lewat matchPath, tanpa migrasi ke createBrowserRouter).
const Dashboard     = lazy(() => import("../pages/Dashboard.jsx"));
const Inbox         = lazy(() => import("../pages/Inbox.jsx"));
const Customers     = lazy(() => import("../pages/Customers.jsx"));
const Pipeline      = lazy(() => import("../pages/Pipeline.jsx"));
const Orders        = lazy(() => import("../pages/Orders.jsx"));
const Broadcast     = lazy(() => import("../pages/Broadcast.jsx"));
const Automation    = lazy(() => import("../pages/Automation.jsx"));
const Laporan       = lazy(() => import("../pages/Laporan.jsx"));
const Pengaturan    = lazy(() => import("../pages/Pengaturan.jsx"));
const PengaturanSales = lazy(() => import("../pages/PengaturanSales.jsx"));
const QualityScorer   = lazy(() => import("../pages/QualityScorer.jsx"));
const SalesRisk        = lazy(() => import("../pages/SalesRisk.jsx"));
const SalesPerformance = lazy(() => import("../pages/SalesPerformance.jsx"));
const Pengguna      = lazy(() => import("../pages/Pengguna.jsx"));
const Products      = lazy(() => import("../pages/Products.jsx"));
const TrackingLinks = lazy(() => import("../pages/TrackingLinks.jsx"));
const BroadcastSales = lazy(() => import("../pages/BroadcastSales.jsx"));
const CoPilot       = lazy(() => import("../pages/CoPilot.jsx"));
const Portal        = lazy(() => import("../pages/Portal.jsx"));
const DivisionPage  = lazy(() => import("../pages/DivisionPage.jsx"));
const Notifications = lazy(() => import("../pages/Notifications.jsx"));
const ProductionMaterialUsage = lazy(() => import("../pages/bengkel/ProductionMaterialUsage.jsx"));
const ArmadaDashboard   = lazy(() => import("../pages/armada/ArmadaDashboard.jsx"));
const ArmadaRingkasan   = lazy(() => import("../pages/armada/ArmadaRingkasan.jsx"));
const ArmadaJobs        = lazy(() => import("../pages/armada/ArmadaJobs.jsx"));
const ArmadaOrders      = lazy(() => import("../pages/armada/ArmadaOrders.jsx"));
const ArmadaRoutes      = lazy(() => import("../pages/armada/ArmadaRoutes.jsx"));
const ArmadaKendaliRute = lazy(() => import("../pages/armada/ArmadaKendaliRute.jsx"));
const ArmadaPengaturan  = lazy(() => import("../pages/armada/ArmadaPengaturan.jsx"));
const ArmadaPod         = lazy(() => import("../pages/armada/ArmadaPod.jsx"));
const ArmadaTracking    = lazy(() => import("../pages/armada/ArmadaTracking.jsx"));
const ArmadaIssues      = lazy(() => import("../pages/armada/ArmadaIssues.jsx"));
const ArmadaReturns     = lazy(() => import("../pages/armada/ArmadaReturns.jsx"));
const ArmadaDeliveryReport = lazy(() => import("../pages/armada/ArmadaDeliveryReport.jsx"));
const ArmadaBiaya       = lazy(() => import("../pages/armada/ArmadaBiaya.jsx"));
const ArmadaPengajuanBiaya = lazy(() => import("../pages/armada/ArmadaPengajuanBiaya.jsx"));
const ArmadaInsentifSnapshot = lazy(() => import("../pages/armada/ArmadaInsentifSnapshot.jsx"));
const ArmadaPembayaranInsentif = lazy(() => import("../pages/armada/ArmadaPembayaranInsentif.jsx"));
const Kendali        = lazy(() => import("../pages/Kendali.jsx"));
// Finance Workspace (D-180, 17 September 2026)
const FinanceDashboard      = lazy(() => import("../pages/finance/FinanceDashboard.jsx"));
const FinanceAccounts       = lazy(() => import("../pages/finance/FinanceAccounts.jsx"));
const FinanceCash           = lazy(() => import("../pages/finance/FinanceCash.jsx"));
const FinancePayments       = lazy(() => import("../pages/finance/FinancePayments.jsx"));
const FinanceReceivables    = lazy(() => import("../pages/finance/FinanceReceivables.jsx"));
const FinancePemasukan      = lazy(() => import("../pages/finance/FinancePemasukan.jsx"));
const FinanceInvoices       = lazy(() => import("../pages/finance/FinanceInvoices.jsx"));
const FinanceExpenses       = lazy(() => import("../pages/finance/FinanceExpenses.jsx"));
const FinancePurchases      = lazy(() => import("../pages/finance/FinancePurchases.jsx"));
const FinanceKasbon         = lazy(() => import("../pages/finance/FinanceKasbon.jsx"));
const FinancePenjualanKaryawan = lazy(() => import("../pages/finance/FinancePenjualanKaryawan.jsx"));
const FinancePengecualianLunas = lazy(() => import("../pages/finance/FinancePengecualianLunas.jsx"));
const FinanceUangMuka       = lazy(() => import("../pages/finance/FinanceUangMuka.jsx"));
const FinanceSuppliers      = lazy(() => import("../pages/finance/FinanceSuppliers.jsx"));
const FinanceJournal        = lazy(() => import("../pages/finance/FinanceJournal.jsx"));
const FinancePersediaanAwal = lazy(() => import("../pages/finance/FinancePersediaanAwal.jsx"));
const PengajuanBiayaWorkspace = lazy(() => import("../pages/pengajuanBiaya/PengajuanBiayaWorkspace.jsx"));
const PengajuanBiayaHub = lazy(() => import("../pages/pengajuanBiaya/PengajuanBiayaHub.jsx"));
const FinanceLedger         = lazy(() => import("../pages/finance/FinanceLedger.jsx"));
const FinanceReports        = lazy(() => import("../pages/finance/FinanceReports.jsx"));
const FinanceLaporanDivisi  = lazy(() => import("../pages/finance/FinanceLaporanDivisi.jsx"));
const LaporanBiayaDivisi    = lazy(() => import("../pages/laporanDivisi/LaporanBiayaDivisi.jsx"));
const FinanceReconciliation = lazy(() => import("../pages/finance/FinanceReconciliation.jsx"));
const FinanceSettings       = lazy(() => import("../pages/finance/FinanceSettings.jsx"));
const B2BOrders       = lazy(() => import("../pages/b2b/B2BOrders.jsx"));
const ComplaintCases  = lazy(() => import("../pages/ComplaintCases.jsx"));
const Gudang         = lazy(() => import("../pages/Gudang.jsx"));
const WarehouseDashboard   = lazy(() => import("../pages/warehouse/WarehouseDashboard.jsx"));
const WarehouseInventory   = lazy(() => import("../pages/warehouse/WarehouseInventory.jsx"));
const WarehouseGoodsReceipt = lazy(() => import("../pages/warehouse/WarehouseGoodsReceipt.jsx"));
const WarehouseUnitCustody = lazy(() => import("../pages/warehouse/WarehouseUnitCustody.jsx"));
const WarehouseMaterialPickup = lazy(() => import("../pages/warehouse/WarehouseMaterialPickup.jsx"));
const WarehouseFinishedGoods = lazy(() => import("../pages/warehouse/WarehouseFinishedGoods.jsx"));
const WarehouseMaterialIssue = lazy(() => import("../pages/warehouse/WarehouseMaterialIssue.jsx"));
const WarehouseTransfers = lazy(() => import("../pages/warehouse/WarehouseTransfers.jsx"));
const WarehouseStockCount = lazy(() => import("../pages/warehouse/WarehouseStockCount.jsx"));
const WarehouseAdjustments = lazy(() => import("../pages/warehouse/WarehouseAdjustments.jsx"));
const WarehouseReplenishment = lazy(() => import("../pages/warehouse/WarehouseReplenishment.jsx"));
const WarehouseReports = lazy(() => import("../pages/warehouse/WarehouseReports.jsx"));
// P8 Production Experience V2 (inert bila reader V2 OFF). Aplikasi PIC Table/Corner & Andon TV adalah halaman MANDIRI (App.jsx STANDALONE_PAGES).
const ProductionPlannerV2 = lazy(() => import("../pages/bengkel/ProductionPlannerV2.jsx"));
const ProductionReportV2 = lazy(() => import("../pages/bengkel/ProductionReportV2.jsx"));
// P11 — KPI Produksi & Gudang (baca-saja; reader V2 OFF -> pesan kosong, bukan error).
const ProductionKpi = lazy(() => import("../pages/bengkel/ProductionKpi.jsx"));
// P12A — pembungkus Mode Demo (Admin/Owner; ?demo=1): toggle + label + gerbang data sintetis. Dataset-nya TIDAK di bundel utama.
// P9B.1 — workspace penjadwalan BARU ("Rencana Produksi"), terpisah dari halaman status pipeline di atas
// (ProductionPlannerV2, sekarang berjudul tampilan "Status Produksi" tapi URL-nya tetap production-v2).
const ProductionRencanaWorkspace = lazy(() => import("../pages/bengkel/ProductionRencanaWorkspace.jsx"));
const WarehouseProductionQueue = lazy(() => import("../pages/warehouse/WarehouseProductionQueue.jsx"));
const WorkerLane = lazy(() => import("../pages/produksi/WorkerLane.jsx"));
const ProductionDocumentation = lazy(() => import("../pages/produksi/ProductionDocumentation.jsx"));
const ProductionAndon = lazy(() => import("../pages/bengkel/ProductionAndon.jsx"));
// P8.1 (UI & Navigation Consolidation, 29 September 2026) — hub/halaman BARU
// murni navigasi & layout; TIDAK ada state machine/API/migration baru.
const ProductionRingkasan = lazy(() => import("../pages/bengkel/ProductionRingkasan.jsx"));
const ProductionQcHub = lazy(() => import("../pages/bengkel/ProductionQcHub.jsx"));
const ProductionOrdersHub = lazy(() => import("../pages/bengkel/ProductionOrdersHub.jsx"));
// P12B.2 — hub gabungan baru (reuse halaman & endpoint lama): Biaya Produksi, Komplain & Revisi, Pengaturan Produksi.
const ProductionCostHub = lazy(() => import("../pages/bengkel/ProductionCostHub.jsx"));
const ProductionComplaintsHub = lazy(() => import("../pages/bengkel/ProductionComplaintsHub.jsx"));
const ProductionSettings = lazy(() => import("../pages/bengkel/ProductionSettings.jsx"));

// Halaman MANDIRI (P8): dirender App.jsx di luar sidebar/tab desktop — aplikasi PIC (PWA mobile) dan kiosk Andon TV. Tetap wajib login.
export const STANDALONE_PAGES = [
  { path: "/produksi/meja", render: (ctx) => <DemoPage slotBar><WorkerLane lane="TABLE" user={ctx?.user} onLogout={ctx?.onLogout} /></DemoPage> },
  { path: "/produksi/corner", render: (ctx) => <DemoPage slotBar><WorkerLane lane="CORNER" user={ctx?.user} onLogout={ctx?.onLogout} /></DemoPage> },
  { path: "/produksi/dokumentasi", render: (ctx) => <DemoPage slotBar><ProductionDocumentation user={ctx?.user} onLogout={ctx?.onLogout} /></DemoPage> },
  { path: "/produksi/ringkasan-saya", render: () => <ProductionKpi /> }, // P11 — ringkasan pekerjaan sendiri (PIC/dokumentasi/QC)
  { path: "/bengkel/andon", render: () => <ProductionAndon /> },
];
export function standalonePageFor(pathname) {
  return STANDALONE_PAGES.find((p) => matchPath({ path: p.path, end: true }, pathname)) || null;
}

// D-144 (9 September 2026) — sistem tab dalam-app: sebuah TAB menyimpan
// path TUJUAN NYATA-nya sendiri, bukan pernah path redirect ("/", "/armada",
// "/warehouse", catch-all "*"). `<Navigate>` di dalam elemen yang di-render
// per-tab (lewat <Routes location={tab.path}>, lihat lib/TabsContext.jsx)
// akan memanggil navigate() milik ROUTER SUNGGUHAN (BrowserRouter, satu-
// satunya di app ini) — BUKAN cuma mengubah "lokasi virtual" tab itu — jadi
// kalau dibiarkan, membuka tab baru di path redirect bisa diam-diam
// membajak URL asli tab yang SEDANG AKTIF/terlihat, bukan tab yang baru
// dibuka. Makanya redirect-redirect ini diselesaikan LEBIH DULU di sini
// (resolveEntryPath), SEBELUM sebuah path pernah sempat tersimpan sebagai
// path sebuah tab — PAGES di bawah jadi murni "halaman tujuan nyata",
// tanpa entri redirect sama sekali.
function isDriverOnlyUser() {
  try {
    const roles = rolesOf(JSON.parse(localStorage.getItem("user") || "null"));
    return roles.some((r) => ["DRIVER", "HELPER"].includes(r)) && !roles.some((r) => ["ADMIN", "DISPATCHER", "LEADER_DRIVER"].includes(r));
  } catch {
    return false; // user tidak terbaca — perlakukan sebagai non-driver
  }
}

// P8.1 (UI & Navigation Consolidation) — menu "Riwayat" mengarah ke
// /bengkel/order-produksi?tab=work-order&status=DELIVERED (query string,
// BUKAN halaman baru — lihat ProductionOrdersHub.jsx). matchPath TIDAK
// paham "?..." menempel di pathname (akan gagal cocok, jatuh ke fallback
// "/portal"), jadi query string dipisah SEBELUM dicocokkan lalu ditempel
// kembali ke hasilnya. Pemanggil lama (tanpa "?" sama sekali) berperilaku
// identik persis seperti sebelumnya.
export function resolveEntryPath(pathname) {
  // P12B.2: rute Production lama → halaman kanonis baru SEBELUM dicocokkan (tab tidak pernah menyimpan rute lama).
  const translated = tabPathFor(pathname);
  if (translated !== pathname) return resolveEntryPath(translated);
  const { base, search } = splitPathQuery(pathname);
  if (base === "/") return "/portal";
  // /finance (tanpa sub-path) dirujuk PORTALS backend & WorkspaceSwitcher —
  // diselesaikan di sini supaya tidak pernah tersimpan sebagai path sebuah
  // tab (lihat catatan panjang D-144 di atas).
  if (base === "/finance") return "/finance/dashboard";
  if (base === "/warehouse") return "/warehouse/dashboard";
  if (base === "/armada") return isDriverOnlyUser() ? "/armada/jobs" : "/armada/dashboard";
  const dikenal = PAGES.some((p) => matchPath({ path: p.path, end: true }, base));
  return dikenal ? base + search : "/portal"; // setara catch-all "*" lama
}

export function RouteFallback() {
  return (
    <div className="page-loading">
      <div className="skeleton skeleton-card" style={{ maxWidth: 400, margin: "0 auto" }} />
    </div>
  );
}

// `render(ctx)` menerima { user, onUserUpdate } — konteks yang sebelumnya
// dioper langsung sebagai prop JSX di App.jsx. Path & props PERSIS sama,
// cuma sumbernya dipindah ke sini. Path redirect ("/", "/armada",
// "/warehouse", "*") SENGAJA tidak ada di sini — lihat resolveEntryPath.
export const PAGES = [
  { path: "/portal",      render: () => <Portal /> },
  { path: "/portal/:key", render: (ctx) => <DivisionPage user={ctx.user} /> },
  { path: "/bengkel/materials", render: () => <ProductionMaterialUsage /> },
  { path: "/bengkel/kpi", render: () => <DemoPage><ProductionKpi /></DemoPage> },
  { path: "/armada/dashboard", render: () => <ArmadaDashboard /> },
  { path: "/armada/ringkasan", render: () => <ArmadaRingkasan /> },
  { path: "/armada/jobs",      render: () => <ArmadaJobs /> },
  { path: "/armada/orders",    render: () => <ArmadaOrders /> },
  { path: "/armada/routes", render: () => <ArmadaRoutes /> },
  { path: "/armada/kendali-rute", render: (ctx) => <ArmadaKendaliRute user={ctx.user} /> },
  { path: "/armada/tracking", render: () => <ArmadaTracking /> },
  { path: "/armada/pengaturan", render: () => <ArmadaPengaturan /> },
  { path: "/armada/biaya", render: () => <ArmadaBiaya /> },
  { path: "/armada/pengajuan-biaya", render: () => <ArmadaPengajuanBiaya /> },
  { path: "/armada/pod", render: () => <ArmadaPod /> },
  { path: "/armada/issues", render: () => <ArmadaIssues /> },
  { path: "/armada/returns", render: () => <ArmadaReturns /> },
  { path: "/armada/reports", render: () => <ArmadaDeliveryReport /> },
  { path: "/armada/insentif-snapshot", render: () => <ArmadaInsentifSnapshot /> },
  { path: "/armada/pembayaran-insentif", render: () => <ArmadaPembayaranInsentif /> },
  { path: "/kendali",     render: () => <Kendali /> },
  { path: "/finance/dashboard",      render: () => <FinanceDashboard /> },
  { path: "/finance/payments",       render: () => <FinancePayments /> },
  { path: "/finance/invoices",       render: () => <FinanceInvoices /> },
  { path: "/finance/receivables",    render: () => <FinanceReceivables /> },
  { path: "/finance/pemasukan",      render: () => <FinancePemasukan /> },
  { path: "/finance/cash",           render: () => <FinanceCash /> },
  { path: "/finance/expenses",       render: () => <FinanceExpenses /> },
  { path: "/finance/purchases",      render: () => <FinancePurchases /> },
  { path: "/finance/kasbon",         render: () => <FinanceKasbon /> },
  { path: "/finance/penjualan-karyawan", render: () => <FinancePenjualanKaryawan /> },
  { path: "/finance/pengecualian-lunas", render: () => <FinancePengecualianLunas /> },
  { path: "/finance/uang-muka",      render: () => <FinanceUangMuka /> },
  { path: "/finance/suppliers",      render: () => <FinanceSuppliers /> },
  { path: "/finance/reconciliation", render: () => <FinanceReconciliation /> },
  { path: "/finance/journal",        render: () => <FinanceJournal /> },
  { path: "/finance/persediaan-awal", render: () => <FinancePersediaanAwal /> },
  // C1 — Pengajuan Biaya Produksi & Gudang (halaman generik; jenis biaya & tautan dari konfigurasi server)
  { path: "/warehouse/pengajuan-biaya", render: () => <PengajuanBiayaWorkspace workspace="WAREHOUSE" /> },
  // C2 — Marketing, Management, HR-GA: komponen yang SAMA (konfigurasi dari server); hub Finance untuk melihat semua divisi
  { path: "/marketing/pengajuan-biaya", render: () => <PengajuanBiayaWorkspace workspace="MARKETING" /> },
  { path: "/kendali/pengajuan-biaya", render: () => <PengajuanBiayaWorkspace workspace="MANAGEMENT" /> },
  { path: "/kendali/pengajuan-hrga", render: () => <PengajuanBiayaWorkspace workspace="HR_GA" /> },
  { path: "/finance/pengajuan-divisi", render: () => <PengajuanBiayaHub /> },
  { path: "/finance/ledger",         render: () => <FinanceLedger /> },
  { path: "/finance/reports",        render: () => <FinanceReports /> },
  // Fase 2 — Laporan Biaya per Divisi: Finance melihat semua; workspace divisi memakai komponen yang sama dikunci ke divisinya (izin di server)
  { path: "/finance/laporan-divisi", render: () => <FinanceLaporanDivisi /> },
  { path: "/armada/laporan-biaya",    render: () => <LaporanBiayaDivisi scope="DELIVERY" judul="Laporan Biaya Delivery" /> },
  { path: "/warehouse/laporan-biaya", render: () => <LaporanBiayaDivisi scope="WAREHOUSE" judul="Laporan Biaya Gudang" /> },
  { path: "/marketing/laporan-biaya", render: () => <LaporanBiayaDivisi scope="MARKETING" judul="Laporan Biaya Marketing" /> },
  { path: "/kendali/laporan-biaya",   render: () => <LaporanBiayaDivisi scope="MANAGEMENT" judul="Laporan Biaya Management" /> },
  { path: "/kendali/laporan-hrga",    render: () => <LaporanBiayaDivisi scope="HR_GA" judul="Laporan Biaya HR & GA" /> },
  { path: "/finance/accounts",       render: () => <FinanceAccounts /> },
  { path: "/finance/settings",       render: () => <FinanceSettings /> },
  { path: "/b2b",         render: () => <B2BOrders /> },
  { path: "/komplain",    render: () => <ComplaintCases /> },
  { path: "/gudang",      render: () => <Gudang /> },
  { path: "/warehouse/dashboard", render: () => <WarehouseDashboard /> },
  { path: "/warehouse/inventory", render: () => <WarehouseInventory /> },
  { path: "/warehouse/goods-receipt", render: () => <WarehouseGoodsReceipt /> },
  { path: "/warehouse/unit-custody", render: () => <WarehouseUnitCustody /> },
  { path: "/bengkel/production-v2", render: () => <DemoPage><ProductionPlannerV2 /></DemoPage> },
  { path: "/bengkel/production-v2/laporan/:runId", render: () => <ProductionReportV2 /> },
  // P9B.1 — workspace penjadwalan baru, URL sendiri (bukan sub-path production-v2, supaya tidak butuh redirect/D-144).
  { path: "/bengkel/rencana-produksi", render: () => <DemoPage><ProductionRencanaWorkspace /></DemoPage> },
  // P8.1 (UI & Navigation Consolidation) — rute BARU murni navigasi/layout.
  { path: "/bengkel/ringkasan", render: () => <DemoPage><ProductionRingkasan /></DemoPage> },
  { path: "/bengkel/quality-control", render: () => <DemoPage><ProductionQcHub /></DemoPage> },
  { path: "/bengkel/order-produksi", render: () => <ProductionOrdersHub /> },
  { path: "/bengkel/biaya-produksi", render: () => <ProductionCostHub /> },
  { path: "/bengkel/komplain-revisi", render: () => <ProductionComplaintsHub /> },
  { path: "/bengkel/pengaturan", render: () => <ProductionSettings /> },
  { path: "/warehouse/antrean-produksi", render: () => <DemoPage><WarehouseProductionQueue /></DemoPage> },
  { path: "/warehouse/finished-goods", render: () => <WarehouseFinishedGoods /> },
  { path: "/warehouse/material-pickup", render: () => <WarehouseMaterialPickup /> },
  { path: "/warehouse/material-issue", render: () => <WarehouseMaterialIssue /> },
  { path: "/warehouse/transfers", render: () => <WarehouseTransfers /> },
  { path: "/warehouse/stock-count", render: () => <WarehouseStockCount /> },
  { path: "/warehouse/replenishment", render: () => <WarehouseReplenishment /> },
  { path: "/warehouse/adjustments", render: () => <WarehouseAdjustments /> },
  { path: "/warehouse/reports", render: () => <WarehouseReports /> },
  { path: "/warehouse/kpi", render: () => <DemoPage><ProductionKpi defaultTab="gudang" /></DemoPage> },
  { path: "/dashboard",   render: (ctx) => <Dashboard user={ctx.user} /> },
  { path: "/inbox",       render: (ctx) => <Inbox user={ctx.user} /> },
  { path: "/customers",   render: () => <Customers /> },
  { path: "/pipeline",    render: () => <Pipeline /> },
  { path: "/orders",      render: () => <Orders /> },
  { path: "/broadcast",   render: () => <Broadcast /> },
  { path: "/automation",  render: () => <Automation /> },
  { path: "/laporan",     render: () => <Laporan /> },
  { path: "/pengaturan",  render: (ctx) => <Pengaturan user={ctx.user} onUserUpdate={ctx.onUserUpdate} /> },
  { path: "/pengaturan-sales", render: (ctx) => <PengaturanSales user={ctx.user} /> },
  { path: "/quality-scorer", render: () => <QualityScorer /> },
  { path: "/sales-risk", render: () => <SalesRisk /> },
  { path: "/sales-intelligence", render: () => <SalesPerformance /> },
  { path: "/pengguna",    render: (ctx) => <Pengguna user={ctx.user} onUserUpdate={ctx.onUserUpdate} /> },
  { path: "/products",    render: (ctx) => <Products user={ctx.user} /> },
  { path: "/tracking",    render: () => <TrackingLinks /> },
  { path: "/broadcast-sales", render: () => <BroadcastSales /> },
  { path: "/copilot",     render: () => <CoPilot /> },
  { path: "/notifications", render: () => <Notifications /> },
];
