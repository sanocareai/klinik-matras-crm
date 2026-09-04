import React from "react";
import { TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils.js";
import InfoTooltip from "./info-tooltip.jsx";

// ─── STAT CARD (DS v2.2) — kartu KPI berisian penuh ──────────────────────────
// Gaya mengikuti kartu metrik Google Ads: BLOK BERWARNA PENUH, bukan kartu
// putih dengan ubin ikon kecil. Yang berbeda dari Google Ads: di sana tiap blok
// hue-nya lain (biru/merah/kuning/hijau); di sini SATU keluarga biru dengan
// KEDALAMAN bertingkat — seragam tapi tetap membentuk gradasi terang→gelap.
//
// depth 1..2 = tint terang, teks biru gelap
// depth 3..4 = biru pekat, teks putih
// Semua pasangan bg/teks di bawah sudah dicek kontrasnya untuk light & dark.
// Opacity caption dinaikkan (70→80, 60→75, 65→80) — nilai lama terlalu pudar
// di layar produksi ("teks putih/abu susah dibaca" pada blok biru pekat).
const SKIN = {
  1: { box: "bg-blue-100",  label: "text-blue-800/80", value: "text-blue-900", icon: "bg-blue-200 text-blue-800",  sub: "text-blue-800/75" },
  2: { box: "bg-blue-200",  label: "text-blue-900/80", value: "text-blue-900", icon: "bg-blue-300 text-blue-900",  sub: "text-blue-900/75" },
  3: { box: "bg-bluesolid/85", label: "text-white/85", value: "text-white",    icon: "bg-white/20 text-white",     sub: "text-white/80" },
  4: { box: "bg-bluesolid", label: "text-white/85",    value: "text-white",    icon: "bg-white/20 text-white",     sub: "text-white/80" },
};

export default function StatCard({
  label, value, icon: Icon, depth = 1, delta, deltaSuffix, note, tooltip,
  onClick, className,
}) {
  const s = SKIN[depth] || SKIN[1];
  const adaDelta = delta != null && Number.isFinite(delta);
  const naik = adaDelta && delta >= 0;
  const Arrow = naik ? TrendingUp : TrendingDown;
  // Di blok pekat (depth 3–4), hijau/merah semantik tidak cukup kontras di atas
  // biru tua — delta-nya dibuat putih dan arah dibaca dari ikon panahnya.
  const gelap = depth >= 3;

  return (
    <div
      className={cn(
        // "kpi-glass-guard" (D-090, RENAMED D-094 — bug nyata, lihat bawah)
        // — penanda murni CSS, bukan style baru: dipakai styles/delivery-
        // dark.css/-light.css untuk MENGECUALIKAN kartu ini dari override
        // kaca generik (`[class*="rounded-card"]`). Kartu ini punya warna
        // sendiri per depth (bg-blue-100/200/bluesolid + teks GELAP yang
        // didesain untuk latar TERANG, lihat SKIN di atas) — kalau ikut
        // ditimpa jadi satu warna kaca navy, teks depth 1-2 nyaris tak
        // terbaca (teks tetap gelap, cuma latarnya yang berubah gelap juga).
        //
        // ⚠️ BUG NYATA D-090→D-094: nama sebelumnya "stat-card" TERNYATA
        // BENTROK dengan class GLOBAL lama dari sebelum Tailwind (index.css
        // baris ~1483, `.stat-card{background:#fff;...}`) + satu rule massal
        // di tokens.css (`.card,.chart-card,.stat-card,...{background-color:
        // var(--bg-surface);border:none!important}`). tokens.css dimuat
        // SETELAH tailwind.css (lihat main.jsx) jadi menang atas utility
        // `bg-bluesolid` (spesifisitas SAMA, urutan lebih akhir) — background
        // asli kartu ke-timpa jadi var(--bg-surface) TANPA disadari. Di dark
        // mode kebetulan tidak kentara (--bg-surface gelap + teks blue-800/
        // 900 dark theme SUDAH terang, masih kebaca) tapi di LIGHT mode
        // --bg-surface nyaris putih + depth 3-4 pakai text-white → teks DAN
        // ikon lenyap total (putih di atas putih), laporan owner: kartu
        // Revenue/Conversion kelihatan KOSONG BLANK. Diverifikasi byte-exact
        // di CSS produksi sebelum diperbaiki (bukan tebakan). Nama baru
        // sengaja diverifikasi dulu (grep) nol-tabrakan di seluruh project.
        "kpi-glass-guard flex flex-col gap-3 rounded-card p-5 shadow-card transition-shadow",
        s.box,
        onClick && "cursor-pointer hover:shadow-popover",
        className
      )}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter") onClick(); } : undefined}
    >
      <span className={cn("stat-card-icon inline-flex h-10 w-10 items-center justify-center rounded-chip", s.icon)}>
        {Icon && <Icon size={19} strokeWidth={2} />}
      </span>

      <div>
        <span className="flex items-center gap-1.5">
          <p className={cn("text-[13px] font-medium", s.label)}>{label}</p>
          {tooltip && (
            <InfoTooltip
              text={tooltip}
              className={gelap ? "text-white/70 hover:text-white" : undefined}
            />
          )}
        </span>
        {/* "dh-figure" (D-091) — kelas SUDAH ADA, dipakai angka besar Delivery
            Hub (text-shadow tipis, "menyala" di atas kaca gelap). Dipakai
            ULANG di sini, BUKAN warna baru — tetap satu keluarga biru,
            cuma menambah glow supaya angka KPI terasa hidup di halaman
            Dashboard yang sekarang kaca (D-090). No-op di tempat lain:
            kelasnya cuma bereaksi di dalam `.glass-division` (lihat
            delivery-dark.css §9 dan delivery-light.css §9 yang sengaja
            tidak punya aturan untuk kelas ini di mode terang). */}
        <p className={cn("dh-figure mt-1 text-[30px] font-bold leading-none tracking-[-0.02em] tabular-nums", s.value)}>
          {value}
        </p>
      </div>

      {adaDelta && (
        <div className="flex items-baseline gap-1.5">
          <span className={cn(
            "inline-flex items-center gap-0.5 text-[13px] font-semibold tabular-nums",
            gelap ? "text-white" : naik ? "text-green" : "text-red"
          )}>
            <Arrow size={13} strokeWidth={2.5} />
            {naik ? "+" : ""}{Number(delta).toFixed(1)}%
          </span>
          <span className={cn("text-[11px]", s.sub)}>{deltaSuffix}</span>
        </div>
      )}
      {!adaDelta && deltaSuffix && (
        <span className={cn("text-[11px]", s.sub)}>{deltaSuffix}</span>
      )}
      {note && (
        <span className={cn("text-[11px]", s.sub)}>{note}</span>
      )}
    </div>
  );
}
