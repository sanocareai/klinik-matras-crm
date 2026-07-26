import React from "react";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils.js";

// ─── BADGE (Sano DS v2) ──────────────────────────────────────────────────────
// TANPA border, TANPA "isian + outline". Pola tunggal: teks berwarna semantik
// di atas latar 10% opacity dari HUE YANG SAMA. r-sm, 11px uppercase, 4px/8px.
//
// Hanya 4 hue yang boleh: accent (informasi/netral) + red/orange/green (makna).
// Semua nama variant lama tetap valid supaya pemakaian yang ada tidak pecah,
// tapi hue dekoratif (violet dsb) dilipat ke accent.
const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-chip px-2 py-1 text-[11px] font-medium uppercase tracking-[0.05em]",
  {
    variants: {
      variant: {
        neutral: "bg-inset text-ink2",
        accent:  "bg-accentbg text-accent",
        red:     "bg-redbg text-red",
        orange:  "bg-orangebg text-orange",
        green:   "bg-greenbg text-green",

        // ── alias kompatibilitas ──
        success: "bg-greenbg text-green",
        warning: "bg-orangebg text-orange",
        danger:  "bg-redbg text-red",
        info:    "bg-accentbg text-accent",
        brand:   "bg-accentbg text-accent",
        up:      "bg-greenbg text-green",
        down:    "bg-redbg text-red",
        // violet & ai dilipat ke accent — aturan satu accent.
        violet:  "bg-accentbg text-accent",
        ai:      "bg-accentbg text-accent",
      },
    },
    defaultVariants: { variant: "neutral" },
  }
);

export function Badge({ className, variant, ...props }) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { badgeVariants };
