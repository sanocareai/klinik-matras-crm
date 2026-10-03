import React from "react";
import TabbedHub from "@/components/TabbedHub.jsx";
import ComplaintCases from "../ComplaintCases.jsx";
import ProductionScopeRevisions from "./ProductionScopeRevisions.jsx";

// Komplain & Revisi (P12B.2) — hub: Kasus Aktif (komplain yang belum selesai), Revisi Unit (temuan bongkar yang mengubah lingkup/harga),
// Riwayat (komplain selesai/dibatalkan). Halaman yang SUDAH ADA dipakai ulang (endpoint /complaints & /production/scope-revisions); tanpa API baru.
export const COMPLAINT_HUB_TABS = Object.freeze([
  { key: "aktif", label: "Kasus Aktif" },
  { key: "revisi", label: "Revisi Unit" },
  { key: "riwayat", label: "Riwayat" },
]);

export default function ProductionComplaintsHub() {
  const tabs = [
    { ...COMPLAINT_HUB_TABS[0], keepAlive: false, render: () => <ComplaintCases scope="aktif" /> },
    { ...COMPLAINT_HUB_TABS[1], render: () => <ProductionScopeRevisions /> },
    { ...COMPLAINT_HUB_TABS[2], keepAlive: false, render: () => <ComplaintCases scope="riwayat" /> },
  ];
  return <TabbedHub tabs={tabs} defaultTab="aktif" label="Komplain & Revisi" />;
}
