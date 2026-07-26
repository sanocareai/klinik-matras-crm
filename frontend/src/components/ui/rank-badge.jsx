import React from "react";
import { cn } from "@/lib/utils.js";

// ─── RANK BADGE (DS v2.1) ────────────────────────────────────────────────────
// Nomor peringkat di leaderboard. Referensi memakai medali emas/perak/bronze
// untuk 3 teratas, lalu angka polos untuk sisanya.
//
// DI SINI: 3 teratas TETAP dibedakan — tapi lewat KEDALAMAN BIRU, bukan emas/
// perak/bronze (itu 3 hue tambahan yang melanggar aturan satu keluarga warna).
// Peringkat 1 paling pekat, lalu meredup, dan mulai peringkat 4 jadi angka
// polos tanpa lingkaran. Hierarkinya tetap terbaca sekilas.
const GAYA = {
  1: "bg-bluesolid text-bluesolidink",
  2: "bg-blue-300 text-blue-900",
  3: "bg-blue-100 text-blue-700",
};

export default function RankBadge({ rank, className }) {
  const juara = rank <= 3;
  return (
    <span
      className={cn(
        "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
        "text-[12px] font-bold tabular-nums",
        juara ? GAYA[rank] : "text-ink3",
        className
      )}
      aria-label={`Peringkat ${rank}`}
    >
      {rank}
    </span>
  );
}
