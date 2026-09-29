import React, { useState } from "react";
import ProductionQc from "./ProductionQc.jsx";
import ProductionQcQueue from "./ProductionQcQueue.jsx";

// Quality Control (P8.1, UI & Navigation Consolidation) — hub navigasi untuk
// "Antrean QC (V2)" (ProductionQc.jsx, P6 — cohort V2) + "Inspeksi QC"
// (ProductionQcQueue.jsx, V1 — semua unit) LAMA. Digabung jadi SATU menu
// dengan tab, TANPA mengubah komponen/data di baliknya — keduanya dirender
// apa adanya, tab strip SENGAJA di LUAR PageContainer masing-masing (lihat
// catatan sama di ProductionOrdersHub.jsx). Route lama (/bengkel/qc,
// /bengkel/qc-v2) TETAP ADA (lihat Layout.jsx section "LEGACY (ADMIN)").
// Default tab = V2 (alur QC yang berlaku untuk cohort Production V2 aktif).
const TABS = [
  { key: "v2", label: "Quality Control (V2)" },
  { key: "v1", label: "Inspeksi QC (lama)" },
];

export default function ProductionQcHub() {
  const [tab, setTab] = useState("v2");

  return (
    <div>
      <div role="tablist" aria-label="Tampilan Quality Control" className="flex gap-1 border-b border-line px-4 pt-4 md:px-8 md:pt-6">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-3 py-2 text-[13px] font-semibold ${tab === t.key ? "border-accent text-accent" : "border-transparent text-ink3 hover:text-ink2"}`}>
            {t.label}
          </button>
        ))}
      </div>
      <div className={tab === "v2" ? "" : "hidden"}>
        <ProductionQc />
      </div>
      <div className={tab === "v1" ? "" : "hidden"}>
        <ProductionQcQueue />
      </div>
    </div>
  );
}
