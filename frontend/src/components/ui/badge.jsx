import React from "react";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils.js";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
  {
    variants: {
      variant: {
        // Tren (dipakai MetricCard)
        up:      "bg-chart-green-soft text-chart-green",
        down:    "bg-chart-rose-soft text-chart-rose",
        neutral: "bg-slate-100 text-slate-500",
        brand:   "bg-brand-50 text-brand-700",
        // Semantik status — dipetakan dari domain via helper di utils/format.js
        // (stageVariant / convStatusVariant / healthVariant) supaya warna
        // status = 1 sumber kebenaran, bukan hardcode tersebar.
        success: "bg-chart-green-soft text-chart-green",
        warning: "bg-chart-orange-soft text-chart-orange",
        danger:  "bg-chart-rose-soft text-chart-rose",
        info:    "bg-brand-50 text-brand-700",
        violet:  "bg-chart-violet-soft text-chart-violet",
        // AI — badge "Draf oleh Sano" dsb. HANYA konten AI.
        ai:      "bg-ai-violet-soft text-ai-ink",
      },
    },
    defaultVariants: { variant: "neutral" },
  }
);

export function Badge({ className, variant, ...props }) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
