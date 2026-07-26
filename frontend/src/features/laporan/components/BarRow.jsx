import React from "react";
import { cn } from "@/lib/utils.js";

// Baris "label — bar — angka" untuk distribusi (status order, kategori, kota).
// Dipakai daripada pie/donut: untuk membandingkan BESARAN antar kategori,
// panjang bar jauh lebih mudah dibaca daripada sudut irisan — dan donut
// dengan 1 kategori 100% (kasus "Channel Masuk" di Laporan lama, WhatsApp
// satu-satunya channel) sama sekali tidak menyampaikan informasi.
//
// `tone` hanya boleh accent (default) / green / orange / red — aturan satu
// accent di DS v2; hue dekoratif per-kategori TIDAK dipakai.
const TONE_BAR = {
  accent: "bg-accent",
  green:  "bg-green",
  orange: "bg-orange",
  red:    "bg-red",
  muted:  "bg-line",
};

export default function BarRow({ label, value, max, display, sub, tone = "accent" }) {
  const pct = max > 0 ? Math.max((value / max) * 100, value > 0 ? 2 : 0) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-28 shrink-0 truncate text-xs font-medium text-ink2" title={label}>
        {label}
      </span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-inset">
        <div
          className={cn("h-full rounded-full transition-[width] duration-700 ease-out", TONE_BAR[tone] || TONE_BAR.accent)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-24 shrink-0 text-right text-xs font-bold tabular-nums text-ink">
        {display ?? value}
      </span>
      {sub !== undefined && (
        <span className="w-16 shrink-0 text-right text-[11px] tabular-nums text-ink3">{sub}</span>
      )}
    </div>
  );
}
