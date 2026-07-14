import React from "react";
import { cn } from "@/lib/utils.js";

// Progress bar — target/attainment, funnel share, health. Fill beranimasi dari
// nilai sebelumnya (transition width) saat data berubah. Warna via `variant`,
// dipetakan dari status domain (mis. hijau kalau target tercapai, amber kalau
// di bawah). Lihat sano-components.md §B.3 & sano-animation-guidelines.md §3.5.
const FILL = {
  brand:   "bg-brand-600",
  success: "bg-chart-green",
  warning: "bg-chart-orange",
  danger:  "bg-chart-rose",
  ai:      "bg-ai-gradient",
};

export function ProgressBar({
  value = 0,
  variant = "brand",
  className,
  trackClassName,
  ...props
}) {
  // Clamp 0–100 supaya lebar fill tidak pernah melewati track / negatif.
  const pct = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  return (
    <div
      className={cn("h-2 w-full overflow-hidden rounded-full bg-slate-100", trackClassName)}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      {...props}
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-500 ease-out",
          FILL[variant] || FILL.brand,
          className
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
