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
// 4 & 5 tetap dapat lingkaran (tint paling redup) — bukan angka telanjang.
// Sebelumnya hanya 3 besar yang bulat & 4/5 polos tanpa latar; dalam satu
// kolom leaderboard itu terlihat seperti dua gaya berbeda yang tidak sengaja
// (persis yang ditandai di tangkapan layar). Sekarang seluruh kolom = 5
// lingkaran ukuran sama, kedalaman warna yang menurun membawa hierarkinya.
const GAYA_DEFAULT = "bg-inset text-ink3";

export default function RankBadge({ rank, className }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
        // leading-none WAJIB: tanpa ini, line-height "normal" bawaan font
        // (Inter Variable) membuat glyph angka duduk sedikit di atas pusat
        // vertikal box meski flex items-center sudah dipasang — flex
        // memusatkan LINE BOX, bukan glyph itu sendiri, jadi line-height
        // yang longgar tetap menggeser posisi visualnya.
        "text-[12px] font-bold leading-none tabular-nums",
        GAYA[rank] || GAYA_DEFAULT,
        className
      )}
      aria-label={`Peringkat ${rank}`}
    >
      {rank}
    </span>
  );
}
