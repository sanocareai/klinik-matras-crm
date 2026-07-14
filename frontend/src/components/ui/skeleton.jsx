import React from "react";
import { cn } from "@/lib/utils.js";

// Shimmer skeleton — dipakai KpiCard/ChartCard Laporan selagi data pertama
// kali dimuat, bentuk & ukuran SAMA dengan card final supaya tidak ada
// layout shift saat data datang.
export function Skeleton({ className, ...props }) {
  return (
    <div
      className={cn("animate-pulse rounded-2xl bg-slate-200/70", className)}
      {...props}
    />
  );
}
