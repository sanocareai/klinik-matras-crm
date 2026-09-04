import React from "react";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils.js";

// ─── CARD (Sano DS v2) ───────────────────────────────────────────────────────
// TIDAK ADA BORDER. Hierarki dari tone permukaan + spacing + satu shadow lembut.
// Padding 24px sekarang ada DI Card (v1 menaruhnya di CardHeader/CardContent),
// supaya card tanpa header pun punya padding yang benar.
//
// Nama variant lama DIPERTAHANKAN supaya pemakaian yang sudah ada tidak pecah,
// tapi dipetakan ulang:
//   default     → permukaan standar
//   hero        → SAMA dengan default. Isian navy gelap DIHAPUS (spec Step 4:
//                 angka besar yang membawa emphasis, bukan latarnya). Variant
//                 dibiarkan ada supaya `variant="hero"` di kode lama tetap
//                 valid — hasilnya kini identik dengan default.
//   ai-insight  → permukaan + tint accent tipis; gradient violet dihapus
//                 (aturan satu accent).
// "relative" (D-092) — murni positioning, TANPA efek visual sendiri. Dibutuhkan
// supaya `.dh-bar-left::after`/`.card::before` (delivery-dark.css/-light.css,
// keduanya position:absolute) punya containing block yang benar (tepi Card
// itu sendiri), bukan leluhur lain yang kebetulan positioned. Aman ditambah
// global — tidak menggeser apa pun selama TIDAK ADA descendant absolute yang
// belum sengaja dipasang.
const cardVariants = cva("relative rounded-card bg-surface p-6", {
  variants: {
    variant: {
      default:      "shadow-card",
      hero:         "shadow-card",
      "ai-insight": "bg-accentbg shadow-card",
    },
  },
  defaultVariants: { variant: "default" },
});

export function Card({ className, variant, ...props }) {
  return <div className={cn(cardVariants({ variant }), className)} {...props} />;
}

// ─── CARD INSET ──────────────────────────────────────────────────────────────
// Untuk konten BERSARANG di dalam Card. Tanpa shadow, tanpa border — dibedakan
// HANYA oleh tone permukaan. Radius lebih kecil dari induknya (r-md < r-lg),
// sesuai aturan "anak selalu lebih kecil dari induk".
export function CardInset({ className, ...props }) {
  return <div className={cn("rounded-btn bg-inset p-4", className)} {...props} />;
}

export { cardVariants };

// Header/Content TIDAK lagi membawa padding sendiri (Card sudah p-6) — kalau
// dua-duanya punya padding, hasilnya dobel dan density-nya rusak.
export function CardHeader({ className, ...props }) {
  return <div className={cn("mb-4 flex flex-col gap-1", className)} {...props} />;
}

export function CardTitle({ className, ...props }) {
  return <h3 className={cn("t-card-title", className)} {...props} />;
}

export function CardDescription({ className, ...props }) {
  return <p className={cn("t-secondary", className)} {...props} />;
}

export function CardContent({ className, ...props }) {
  return <div className={cn(className)} {...props} />;
}
