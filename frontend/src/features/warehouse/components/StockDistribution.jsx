import React from "react";
import BarRow from "@/features/laporan/components/BarRow.jsx";
import { formatRupiahShort } from "@/utils/format.js";
import { STOCK_STATUS, ITEM_CATEGORY } from "../data/warehouseMock.js";

// A. Stock Health & B. Inventory by Category.
//
// Dipakai BarRow (bukan pie/donut) mengikuti alasan yang sudah ditulis di
// komponennya: untuk membandingkan BESARAN antar kategori, panjang bar jauh
// lebih mudah dibaca daripada sudut irisan.

export function StockHealthBars({ data }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="space-y-2.5">
      {data.map((d) => {
        const meta = STOCK_STATUS[d.key];
        return (
          <BarRow
            key={d.key}
            label={meta?.label || d.key}
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

export function CategoryBars({ data }) {
  const max = Math.max(1, ...data.map((d) => d.items));
  return (
    <div className="space-y-2.5">
      {data.map((d) => {
        const meta = ITEM_CATEGORY[d.key];
        return (
          <BarRow
            key={d.key}
            label={meta?.label || d.key}
            value={d.items}
            max={max}
            display={`${d.items.toLocaleString("id-ID")} item`}
            sub={formatRupiahShort(d.value)}
          />
        );
      })}
    </div>
  );
}
