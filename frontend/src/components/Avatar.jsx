import React, { useState } from "react";
import { getInitials, avatarColor } from "../utils/format.js";
import { cn } from "../lib/utils.js";

// Avatar inisial berwarna (fallback foto profil WA — lihat CLAUDE.md §7D poin 3:
// tingkat keberhasilan fetch foto TIDAK 100%, tergantung privasi customer,
// jadi fallback ini jalur normal, bukan kasus tepi).
//
// Wave 5A: dimigrasi dari class CSS `.avatar/.avatar-{size}` di index.css ke
// Tailwind. UKURAN DIPERTAHANKAN SAMA PERSIS (32/40/48/64px) supaya layout di
// 13 pemanggil tidak bergeser — ini reskin, bukan redesign.
const SIZE = {
  sm: "h-8 w-8 text-xs",       // 32px — daftar, kanban card, tabel
  md: "h-10 w-10 text-[15px]", // 40px — leaderboard, header
  lg: "h-12 w-12 text-lg",     // 48px
  xl: "h-16 w-16 text-[22px]", // 64px — panel profil
};

export default function Avatar({ name, src, size = "sm", className }) {
  const [imgError, setImgError] = useState(false);
  const initials     = getInitials(name);
  const { bg, text } = avatarColor(name || "?");

  const base = cn(
    "shrink-0 select-none rounded-full object-cover",
    SIZE[size] || SIZE.sm,
    className
  );

  if (src && !imgError) {
    return (
      <img
        src={src}
        alt={initials}
        className={base}
        loading="lazy"
        decoding="async"
        onError={() => setImgError(true)}
      />
    );
  }

  return (
    // Warna inline (bukan class) karena avatarColor() memilih 1 dari 5 palet
    // secara deterministik dari nama — nilainya runtime, tidak bisa jadi class
    // statis yang ke-scan Tailwind.
    <div
      className={cn(base, "flex items-center justify-center font-bold leading-none")}
      style={{ background: bg, color: text }}
      aria-hidden="true"
    >
      {initials}
    </div>
  );
}
