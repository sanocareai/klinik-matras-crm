import React from "react";
import { Skeleton } from "@/components/ui/skeleton.jsx";

// Shimmer loading state — bentuk & ukuran SAMA dengan layout final (KPI
// row 4-up + 2 chart card) supaya tidak ada layout shift saat data datang.
export function KpiRowSkeleton({ count = 4 }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-[152px]" />
      ))}
    </div>
  );
}

export function ChartGridSkeleton({ cols = 2, height = 280 }) {
  return (
    <div className={`grid grid-cols-1 gap-5 ${cols === 2 ? "lg:grid-cols-2" : ""}`}>
      {Array.from({ length: cols }).map((_, i) => (
        <Skeleton key={i} style={{ height }} />
      ))}
    </div>
  );
}
