import React from "react";
import { cn } from "@/lib/utils.js";

// ─── PROGRESS BAR (Sano DS v2) ───────────────────────────────────────────────
// Spec Step 4: tinggi 4px, sudut bulat penuh, track = --hairline, fill = --accent.
//
// Default fill ACCENT, bukan warna-per-status. Progress ke target itu kuantitas,
// bukan peringatan — mewarnai merah/oranye tiap kali di bawah target membuat
// dashboard terlihat "alarm" terus dan warna semantiknya jadi tidak bermakna.
// Variant semantik tetap tersedia untuk kasus yang MEMANG soal makna, dan nama
// variant lama dipetakan ke accent supaya pemakaian yang ada tidak pecah.
const FILL = {
  accent:  "bg-accent",
  green:   "bg-green",
  orange:  "bg-orange",
  red:     "bg-red",

  // alias kompatibilitas — semuanya accent kecuali yang benar-benar semantik
  brand:   "bg-accent",
  ai:      "bg-accent",
  success: "bg-green",
  warning: "bg-orange",
  danger:  "bg-red",
};

export function ProgressBar({
  value = 0,
  variant = "accent",
  className,
  trackClassName,
  ...props
}) {
  // Clamp 0–100 supaya lebar fill tidak pernah melewati track / negatif.
  const pct = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  return (
    <div
      className={cn("h-1 w-full overflow-hidden rounded-full bg-line", trackClassName)}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      {...props}
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-500 ease-out",
          FILL[variant] || FILL.accent,
          className
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
