import React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils.js";

// ─── BUTTON (Sano DS v2) — TIGA TINGKAT ──────────────────────────────────────
// TIDAK ADA BORDER di tingkat mana pun. Pakai secara proporsional:
//   primary   — isian accent, teks putih. MAKSIMAL SATU per region layar.
//   secondary — latar accent-bg, teks accent. Aksi pendukung.
//   tertiary  — teks accent saja, tanpa latar. DEFAULT untuk aksi level-baris.
//
// Nama lama tetap valid (dipakai di banyak tempat) dan dipetakan ke tingkat baru:
//   default → primary · outline → secondary (border dibuang) · ghost → tertiary
//   danger  → destructive · ai → primary (gradient AI dihapus, satu accent)
//
// `neutral` DITAMBAHKAN untuk aksi yang benar-benar netral (mis. "Batal"):
// kalau SEMUA aksi jadi teks biru, sinyal accent-nya luntur. Toolbar netral
// (Refresh/Export) sebaiknya pakai ini, bukan tertiary.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-btn text-sm font-medium " +
  "outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/40 " +
  "disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      variant: {
        primary:     "bg-accent text-white hover:bg-accenthov",
        secondary:   "bg-accentbg text-accent hover:bg-accent/20",
        tertiary:    "bg-transparent text-accent hover:bg-accentbg",
        neutral:     "bg-transparent text-ink2 hover:bg-hovertint",
        destructive: "bg-red text-white hover:opacity-90",

        // ── alias kompatibilitas (jangan dipakai di kode baru) ──
        default: "bg-accent text-white hover:bg-accenthov",
        outline: "bg-accentbg text-accent hover:bg-accent/20",
        ghost:   "bg-transparent text-ink2 hover:bg-hovertint",
        danger:  "bg-red text-white hover:opacity-90",
        ai:      "bg-accent text-white hover:bg-accenthov",
      },
      size: {
        default: "h-9 px-4",
        sm:      "h-8 px-3 text-[13px]",
        lg:      "h-10 px-6",
        icon:    "h-9 w-9 p-0",
      },
    },
    defaultVariants: { variant: "primary", size: "default" },
  }
);

export function Button({ className, variant, size, asChild, ...props }) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { buttonVariants };
