import React from "react";
import { TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils.js";

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
  label, value, icon: Icon, depth = 1, delta, deltaSuffix = "vs last week",
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
        "flex flex-col gap-3 rounded-card p-5 shadow-card transition-shadow",
        s.box,
        onClick && "cursor-pointer hover:shadow-popover",
        className
      )}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter") onClick(); } : undefined}
    >
      <span className={cn("inline-flex h-10 w-10 items-center justify-center rounded-chip", s.icon)}>
        {Icon && <Icon size={19} strokeWidth={2} />}
      </span>

      <div>
        <p className={cn("text-[13px] font-medium", s.label)}>{label}</p>
        <p className={cn("mt-1 text-[30px] font-bold leading-none tracking-[-0.02em] tabular-nums", s.value)}>
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
    </div>
  );
}
