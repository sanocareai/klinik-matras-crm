import React from "react";
import ProductionQc from "./ProductionQc.jsx";
import PreTestQueue from "@/features/production/componentNotes/PreTestQueue.jsx";

// Quality Control (P12B.2) — SATU pengalaman QC (kartu + Unit 360 yang sama dengan Status Produksi). Tab "Inspeksi QC (lama)" dihapus
// dari UI; URL lama (/bengkel/qc, /bengkel/qc-v2) dialihkan ke sini oleh lib/legacyProductionRoutes.js.
export default function ProductionQcHub() {
  // Fase 2 (LAYANAN): antrean pengujian awal PIC QC (hanya tampil untuk pemegang izin QC) di atas antrean QC pasca-perakitan yang sudah ada.
  return <><div className="mx-auto w-full max-w-[1200px] px-4 pt-4"><PreTestQueue /></div><ProductionQc /></>;
}
