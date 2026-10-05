import React from "react";
import ProductionQc from "./ProductionQc.jsx";

// Quality Control (P12B.2) — SATU pengalaman QC (kartu + Unit 360 yang sama dengan Status Produksi). Tab "Inspeksi QC (lama)" dihapus
// dari UI; URL lama (/bengkel/qc, /bengkel/qc-v2) dialihkan ke sini oleh lib/legacyProductionRoutes.js.
export default function ProductionQcHub() {
  return <ProductionQc />;
}
