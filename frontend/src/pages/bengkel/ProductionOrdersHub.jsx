import React from "react";
import TabbedHub from "@/components/TabbedHub.jsx";
import ProductionWorkOrders from "./ProductionWorkOrders.jsx";
import ProductionOrders from "./ProductionOrders.jsx";

// Order Produksi (P12B.2) — SATU hub dengan tiga tab: Aktif (unit yang masih berjalan), Semua (seluruh order), Riwayat (unit terkirim).
// Halaman Work Order & Semua Order yang SUDAH ADA dipakai ulang apa adanya (endpoint sama: getWorkOrders / daftar order); tidak ada API
// atau data baru. URL lama (/bengkel/work-orders, /bengkel/orders, ?tab=work-order&status=DELIVERED) dialihkan oleh lib/legacyProductionRoutes.js.
export const ORDER_HUB_TABS = Object.freeze([
  { key: "aktif", label: "Aktif" },
  { key: "semua", label: "Semua" },
  { key: "riwayat", label: "Riwayat" },
]);

export default function ProductionOrdersHub() {
  const tabs = [
    { ...ORDER_HUB_TABS[0], render: () => <ProductionWorkOrders scope="aktif" /> },
    { ...ORDER_HUB_TABS[1], render: () => <ProductionOrders /> },
    { ...ORDER_HUB_TABS[2], render: () => <ProductionWorkOrders scope="riwayat" /> },
  ];
  return <TabbedHub tabs={tabs} defaultTab="aktif" label="Tampilan Order Produksi" />;
}
