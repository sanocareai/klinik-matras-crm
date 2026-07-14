import React from "react";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils.js";

// PENTING: variant `default` HARUS identik dengan versi lama (kelas yang sama
// persis) supaya semua Card yang sudah dipakai tidak berubah tampilannya saat
// migrasi. Variant baru bersifat aditif. Lihat sano-components.md §B.2.
const cardVariants = cva("rounded-2xl transition-shadow duration-200", {
  variants: {
    variant: {
      default: "border border-black/5 bg-card text-card-foreground shadow-sm hover:shadow-md",
      // Kartu "hero" — SATU per view (KPI paling penting). Gradient navy brand,
      // teks putih. Lihat sano-dashboard-layout.md §2.
      hero: "border border-brand-900/20 bg-gradient-to-br from-brand-800 to-brand-900 text-white shadow-md",
      // Kartu insight/rekomendasi AI. Tint violet lembut + aksen gradient di
      // border kiri. HANYA untuk konten AI. Lihat sano-color-system.md §3.
      "ai-insight": "border border-ai-violet/15 bg-ai-violet-soft/60 text-ai-ink shadow-sm hover:shadow-md",
    },
  },
  defaultVariants: { variant: "default" },
});

export function Card({ className, variant, ...props }) {
  return <div className={cn(cardVariants({ variant }), className)} {...props} />;
}

export { cardVariants };

export function CardHeader({ className, ...props }) {
  return <div className={cn("flex flex-col gap-1 p-5 pb-3", className)} {...props} />;
}

export function CardTitle({ className, ...props }) {
  return <h3 className={cn("text-sm font-semibold text-slate-700", className)} {...props} />;
}

export function CardDescription({ className, ...props }) {
  return <p className={cn("text-xs text-slate-400", className)} {...props} />;
}

export function CardContent({ className, ...props }) {
  return <div className={cn("p-5 pt-0", className)} {...props} />;
}
