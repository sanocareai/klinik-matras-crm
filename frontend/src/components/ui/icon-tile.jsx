import React from "react";
import { cn } from "@/lib/utils.js";

// ─── ICON TILE (DS v2.1) ─────────────────────────────────────────────────────
// Kotak membulat bertint di belakang ikon. Ini komponen yang paling menentukan
// "rasa" UI: tanpa ini semuanya jadi ikon abu di atas putih dan terasa dingin.
//
// SERAGAM TAPI TIDAK RATA: semua ubin memakai KELUARGA biru yang sama, yang
// berbeda hanya KEDALAMAN-nya (depth 1–5). Jadi satu baris KPI bisa terlihat
// bertingkat terang→gelap tanpa memunculkan hue kedua (ungu/oranye/hijau).
//
// depth 1..4 = latar tint + ikon biru (makin dalam makin pekat)
// depth 5    = biru penuh + ikon putih (untuk 1 titik penekanan saja)
const DEPTH = {
  1: "bg-blue-50 text-blue-600",
  2: "bg-blue-100 text-blue-700",
  3: "bg-blue-200 text-blue-800",
  4: "bg-blue-300 text-blue-900",
  // depth 5 pakai token ISIAN PADAT, bukan blue-600: di mode gelap tangga
  // tint jadi lebih terang dan teks putih di atasnya gagal kontras.
  5: "bg-bluesolid text-bluesolidink",
};

const SIZE = {
  sm: "h-8 w-8 rounded-[9px]",
  md: "h-11 w-11 rounded-chip",   // 44px — ukuran di kartu KPI
  lg: "h-12 w-12 rounded-btn",
};

const ICON_SIZE = { sm: 15, md: 20, lg: 22 };

export default function IconTile({
  icon: Icon, depth = 1, size = "md", className, ...props
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center",
        SIZE[size] || SIZE.md,
        DEPTH[depth] || DEPTH[1],
        className
      )}
      aria-hidden="true"
      {...props}
    >
      {Icon && <Icon size={ICON_SIZE[size] || 20} strokeWidth={2} />}
    </span>
  );
}

export { DEPTH as TILE_DEPTH };
