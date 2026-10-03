import React from "react";
import TabbedHub from "@/components/TabbedHub.jsx";
import PengajuanBiayaWorkspace from "../pengajuanBiaya/PengajuanBiayaWorkspace.jsx";
import LaporanBiayaDivisi from "../laporanDivisi/LaporanBiayaDivisi.jsx";

// Biaya Produksi (P12B.2) — hub: Pengajuan (buat pengajuan biaya non-stok), Status Pengajuan (daftar & status), Laporan (laporan biaya divisi Produksi).
// Komponen yang SUDAH ADA dipakai ulang dengan endpoint sama (/expense-submissions, /laporan-divisi); izin tetap ditegakkan server.
export const COST_HUB_TABS = Object.freeze([
  { key: "pengajuan", label: "Pengajuan" },
  { key: "status", label: "Status Pengajuan" },
  { key: "laporan", label: "Laporan" },
]);

const Body = ({ children }) => <div className="mx-auto w-full max-w-[1400px] px-4 py-4 md:px-8">{children}</div>;

export default function ProductionCostHub() {
  // Pengajuan & Status memakai sumber data yang sama → hanya dirender saat aktif (dimuat ulang setiap dibuka, jadi pengajuan baru langsung terlihat).
  const tabs = [
    { ...COST_HUB_TABS[0], keepAlive: false, render: () => <Body><PengajuanBiayaWorkspace workspace="PRODUKSI" embedded view="pengajuan" /></Body> },
    { ...COST_HUB_TABS[1], keepAlive: false, render: () => <Body><PengajuanBiayaWorkspace workspace="PRODUKSI" embedded view="status" /></Body> },
    { ...COST_HUB_TABS[2], render: () => <LaporanBiayaDivisi scope="PRODUCTION" judul="Laporan Biaya Produksi" /> },
  ];
  return <TabbedHub tabs={tabs} defaultTab="pengajuan" label="Biaya Produksi" />;
}
