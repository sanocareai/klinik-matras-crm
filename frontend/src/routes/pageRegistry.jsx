import React, { lazy } from "react";
import { matchPath } from "react-router-dom";
import { rolesOf } from "../lib/roles.js";

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
const Bengkel       = lazy(() => import("../pages/Bengkel.jsx"));
const ProductionWorkOrders = lazy(() => import("../pages/bengkel/ProductionWorkOrders.jsx"));
const ProductionUnitDetail = lazy(() => import("../pages/bengkel/ProductionUnitDetail.jsx"));
const ProductionQcQueue    = lazy(() => import("../pages/bengkel/ProductionQcQueue.jsx"));
const ProductionMaterialUsage = lazy(() => import("../pages/bengkel/ProductionMaterialUsage.jsx"));
const ProductionScopeRevisions = lazy(() => import("../pages/bengkel/ProductionScopeRevisions.jsx"));
const ProductionLaporan = lazy(() => import("../pages/bengkel/ProductionLaporan.jsx"));
const ProductionOrders  = lazy(() => import("../pages/bengkel/ProductionOrders.jsx"));
const ProductionWorkCenters = lazy(() => import("../pages/bengkel/ProductionWorkCenters.jsx"));
const ProductionOperators   = lazy(() => import("../pages/bengkel/ProductionOperators.jsx"));
const ArmadaDashboard   = lazy(() => import("../pages/armada/ArmadaDashboard.jsx"));
const ArmadaRingkasan   = lazy(() => import("../pages/armada/ArmadaRingkasan.jsx"));
const ArmadaJobs        = lazy(() => import("../pages/armada/ArmadaJobs.jsx"));
const ArmadaOrders      = lazy(() => import("../pages/armada/ArmadaOrders.jsx"));
const ArmadaRoutes      = lazy(() => import("../pages/armada/ArmadaRoutes.jsx"));
const ArmadaPengaturan  = lazy(() => import("../pages/armada/ArmadaPengaturan.jsx"));
const ArmadaPod         = lazy(() => import("../pages/armada/ArmadaPod.jsx"));
const ArmadaTracking    = lazy(() => import("../pages/armada/ArmadaTracking.jsx"));
const ArmadaIssues      = lazy(() => import("../pages/armada/ArmadaIssues.jsx"));
const ArmadaReturns     = lazy(() => import("../pages/armada/ArmadaReturns.jsx"));
const ArmadaDeliveryReport = lazy(() => import("../pages/armada/ArmadaDeliveryReport.jsx"));
const Kendali        = lazy(() => import("../pages/Kendali.jsx"));
const Gudang         = lazy(() => import("../pages/Gudang.jsx"));
const WarehouseDashboard   = lazy(() => import("../pages/warehouse/WarehouseDashboard.jsx"));
const WarehouseInventory   = lazy(() => import("../pages/warehouse/WarehouseInventory.jsx"));
const WarehouseGoodsReceipt = lazy(() => import("../pages/warehouse/WarehouseGoodsReceipt.jsx"));
const WarehouseMaterialIssue = lazy(() => import("../pages/warehouse/WarehouseMaterialIssue.jsx"));
const WarehouseTransfers = lazy(() => import("../pages/warehouse/WarehouseTransfers.jsx"));
const WarehouseStockCount = lazy(() => import("../pages/warehouse/WarehouseStockCount.jsx"));
const WarehouseAdjustments = lazy(() => import("../pages/warehouse/WarehouseAdjustments.jsx"));
const WarehouseReplenishment = lazy(() => import("../pages/warehouse/WarehouseReplenishment.jsx"));
const WarehouseReports = lazy(() => import("../pages/warehouse/WarehouseReports.jsx"));

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

export function resolveEntryPath(pathname) {
  if (pathname === "/") return "/portal";
  if (pathname === "/warehouse") return "/warehouse/dashboard";
  if (pathname === "/armada") return isDriverOnlyUser() ? "/armada/jobs" : "/armada/dashboard";
  const dikenal = PAGES.some((p) => matchPath({ path: p.path, end: true }, pathname));
  return dikenal ? pathname : "/portal"; // setara catch-all "*" lama
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
  { path: "/bengkel",     render: () => <Bengkel /> },
  { path: "/bengkel/work-orders", render: () => <ProductionWorkOrders /> },
  { path: "/bengkel/units/:id", render: () => <ProductionUnitDetail /> },
  { path: "/bengkel/qc", render: () => <ProductionQcQueue /> },
  { path: "/bengkel/scope-revisions", render: () => <ProductionScopeRevisions /> },
  { path: "/bengkel/materials", render: () => <ProductionMaterialUsage /> },
  { path: "/bengkel/reports", render: () => <ProductionLaporan /> },
  { path: "/bengkel/orders", render: () => <ProductionOrders /> },
  { path: "/bengkel/work-centers", render: () => <ProductionWorkCenters /> },
  { path: "/bengkel/operators", render: () => <ProductionOperators /> },
  { path: "/armada/dashboard", render: () => <ArmadaDashboard /> },
  { path: "/armada/ringkasan", render: () => <ArmadaRingkasan /> },
  { path: "/armada/jobs",      render: () => <ArmadaJobs /> },
  { path: "/armada/orders",    render: () => <ArmadaOrders /> },
  { path: "/armada/routes", render: () => <ArmadaRoutes /> },
  { path: "/armada/tracking", render: () => <ArmadaTracking /> },
  { path: "/armada/pengaturan", render: () => <ArmadaPengaturan /> },
  { path: "/armada/pod", render: () => <ArmadaPod /> },
  { path: "/armada/issues", render: () => <ArmadaIssues /> },
  { path: "/armada/returns", render: () => <ArmadaReturns /> },
  { path: "/armada/reports", render: () => <ArmadaDeliveryReport /> },
  { path: "/kendali",     render: () => <Kendali /> },
  { path: "/gudang",      render: () => <Gudang /> },
  { path: "/warehouse/dashboard", render: () => <WarehouseDashboard /> },
  { path: "/warehouse/inventory", render: () => <WarehouseInventory /> },
  { path: "/warehouse/goods-receipt", render: () => <WarehouseGoodsReceipt /> },
  { path: "/warehouse/material-issue", render: () => <WarehouseMaterialIssue /> },
  { path: "/warehouse/transfers", render: () => <WarehouseTransfers /> },
  { path: "/warehouse/stock-count", render: () => <WarehouseStockCount /> },
  { path: "/warehouse/replenishment", render: () => <WarehouseReplenishment /> },
  { path: "/warehouse/adjustments", render: () => <WarehouseAdjustments /> },
  { path: "/warehouse/reports", render: () => <WarehouseReports /> },
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
  { path: "/pengguna",    render: (ctx) => <Pengguna user={ctx.user} /> },
  { path: "/products",    render: (ctx) => <Products user={ctx.user} /> },
  { path: "/tracking",    render: () => <TrackingLinks /> },
  { path: "/broadcast-sales", render: () => <BroadcastSales /> },
  { path: "/copilot",     render: () => <CoPilot /> },
  { path: "/notifications", render: () => <Notifications /> },
];
