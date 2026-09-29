import React, { useState } from "react";
import { useSearchParams } from "react-router-dom";
import ProductionWorkOrders from "./ProductionWorkOrders.jsx";
import ProductionOrders from "./ProductionOrders.jsx";

// Order Produksi (P8.1, UI & Navigation Consolidation) — hub navigasi untuk
// "Work Order" + "Semua Order" LAMA (dua halaman TERPISAH sebelumnya, dua
// menu sidebar sendiri-sendiri). Digabung jadi SATU menu dengan tab, TANPA
// mengubah komponen/data di baliknya sama sekali — keduanya dirender apa
// adanya (masing-masing sudah punya PageContainer/PageHeader sendiri, jadi
// tab strip di sini SENGAJA di LUAR PageContainer manapun, bukan menyisipkan
// PageContainer baru yang akan dobel padding). Route lama
// (/bengkel/work-orders, /bengkel/orders) TETAP ADA (lihat Layout.jsx
// section "LEGACY (ADMIN)").
//
// Menu "Riwayat" (Pengaturan & Administrasi) mengarah ke sini dengan
// ?tab=work-order&status=DELIVERED — BUKAN halaman baru, cuma tab Work Order
// pra-filter status "Terkirim" (riwayat unit yang sudah selesai dikirim).
const TABS = [
  { key: "work-order", label: "Work Order" },
  { key: "semua-order", label: "Semua Order" },
];

export default function ProductionOrdersHub() {
  const [params] = useSearchParams();
  const initialTab = params.get("tab") === "semua-order" ? "semua-order" : "work-order";
  const initialStatus = params.get("status") || "";
  const [tab, setTab] = useState(initialTab);

  return (
    <div>
      <div role="tablist" aria-label="Tampilan Order Produksi" className="flex gap-1 border-b border-line px-4 pt-4 md:px-8 md:pt-6">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-3 py-2 text-[13px] font-semibold ${tab === t.key ? "border-accent text-accent" : "border-transparent text-ink3 hover:text-ink2"}`}>
            {t.label}
          </button>
        ))}
      </div>
      {/* Kedua komponen dirender APA ADANYA, hanya disembunyikan lewat CSS
          (bukan unmount) supaya filter/scroll yang belum disimpan tidak
          hilang saat berpindah tab — pola sama dengan TabbedContent.jsx. */}
      <div className={tab === "work-order" ? "" : "hidden"}>
        <ProductionWorkOrders initialStatus={initialStatus} />
      </div>
      <div className={tab === "semua-order" ? "" : "hidden"}>
        <ProductionOrders />
      </div>
    </div>
  );
}
