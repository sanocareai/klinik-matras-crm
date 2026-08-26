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

// BUG YANG DIPERBAIKI (26 Agustus 2026): 3 kolom lebar tetap (label w-28 +
// value w-24 + sub w-16 = 272px) + 2 gap ditambah padding kartu SUDAH
// melebihi lebar layar HP (~360-390px konten setelah padding) SEBELUM bar-
// nya sendiri dapat ruang — flex-1 bar akhirnya terjepit sampai nyaris 0px,
// jadi terlihat seperti "kosong" (bukan cuma tipis) di antara label dan
// angka, persis yang dilaporkan ("banyak UI berantakan di HP/PWA"). Chart
// bar SEHARUSNYA jadi elemen paling informatif di baris ini, bukan yang
// pertama dikorbankan saat ruang sempit.
//
// Fix: default (mobile) TUMPUK 2 baris — baris 1 label+value+sub (padat,
// bar tidak ikut berebut ruang di baris ini), baris 2 bar SELEBAR PENUH.
// Mulai breakpoint sm: kembali ke SATU baris seperti semula (layar cukup
// lebar, tidak perlu ditumpuk). `sm:contents` melepas div pembungkus
// baris-1 dari box model di layar lebar, sehingga label/value/sub kembali
// jadi flex item LANGSUNG di baris yang sama dengan bar — urutan visualnya
// (label → bar → value → sub) diatur lewat `sm:order-*`, bukan urutan DOM
// (DOM tetap label,value,sub lalu bar, supaya baris-1 mobile benar).
export default function BarRow({ label, value, max, display, sub, tone = "accent" }) {
  const pct = max > 0 ? Math.max((value / max) * 100, value > 0 ? 2 : 0) : 0;
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
      <div className="flex items-center gap-2 sm:contents">
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink2 sm:w-28 sm:flex-none" title={label}>
          {label}
        </span>
        <span className="shrink-0 text-right text-xs font-bold tabular-nums text-ink sm:order-3 sm:w-24">
          {display ?? value}
        </span>
        {sub !== undefined && (
          <span className="shrink-0 text-right text-[11px] tabular-nums text-ink3 sm:order-4 sm:w-16">{sub}</span>
        )}
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-inset sm:order-2 sm:w-auto sm:flex-1">
        <div
          className={cn("h-full rounded-full transition-[width] duration-700 ease-out", TONE_BAR[tone] || TONE_BAR.accent)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
