import React from "react";
import BarRow from "@/features/laporan/components/BarRow.jsx";
import { STOCK_STATUS_REAL, CATEGORY_REAL } from "../inventoryReal.js";

// A. Stock Health & B. Inventory by Category — data NYATA (lihat
// WarehouseDashboard.jsx), dihitung dari GET /inventory/stock &
// GET /inventory/reports/summary, bukan data contoh.
//
// Dipakai BarRow (bukan pie/donut) mengikuti alasan yang sudah ditulis di
// komponennya: untuk membandingkan BESARAN antar kategori, panjang bar jauh
// lebih mudah dibaca daripada sudut irisan.

export function StockHealthBars({ data }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="space-y-2.5">
      {data.map((d) => {
        const meta = STOCK_STATUS_REAL[d.key];
        return (
          <BarRow
            key={d.key}
            label={meta?.labelId || d.key}
            value={d.count}
            max={max}
            display={d.count.toLocaleString("id-ID")}
            tone={meta?.tone === "neutral" ? "muted" : meta?.tone}
          />
        );
      })}
    </div>
  );
}

// `value` (nilai Rupiah) SENGAJA tidak ditampilkan — Material tidak punya
// kolom harga/costing lengkap per kategori (lihat catatan di
// routes/warehouseReports.js soal inventoryValuePartial), menampilkan
// angka Rupiah per kategori dari data yang tidak lengkap akan menyesatkan.
export function CategoryBars({ data }) {
  const max = Math.max(1, ...data.map((d) => d.items));
  return (
    <div className="space-y-2.5">
      {data.map((d) => {
        const meta = CATEGORY_REAL[d.key];
        return (
          <BarRow
            key={d.key}
            label={meta?.labelId || d.key || "Tanpa Kategori"}
            value={d.items}
            max={max}
            display={`${d.items.toLocaleString("id-ID")} item`}
          />
        );
      })}
    </div>
  );
}
