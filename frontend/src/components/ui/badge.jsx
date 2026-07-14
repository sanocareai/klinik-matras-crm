import React from "react";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils.js";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
  {
    variants: {
      variant: {
        up:      "bg-chart-green-soft text-chart-green",
        down:    "bg-chart-rose-soft text-chart-rose",
        neutral: "bg-slate-100 text-slate-500",
        brand:   "bg-brand-50 text-brand-700",
      },
    },
    defaultVariants: { variant: "neutral" },
  }
);

export function Badge({ className, variant, ...props }) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
