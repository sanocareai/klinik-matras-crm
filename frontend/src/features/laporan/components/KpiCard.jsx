import React from "react";
import { TrendingUp, TrendingDown, Minus, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils.js";
import { useCountUp } from "@/hooks/useCountUp.js";
import Sparkline from "./Sparkline.jsx";
import InfoTooltip from "./InfoTooltip.jsx";

// KPI card Laporan Analitik — gaya dashboard SaaS modern (referensi:
// Ultraleads/Edaca): card bersih TANPA border (DS v2), label+titik menu "..."
// (dekoratif) di baris atas, angka besar + badge delta SEJAJAR di baris yang
// sama (bukan bertumpuk), sparkline mini opsional di bawah.
//
// ⚠️ BUG NYATA YANG PERNAH TERJADI DI SINI: saat kartu "hero" kehilangan latar
// gradient navy-nya (DS v2 Step 4 — permukaan disamakan dgn kartu lain), teks
// di dalamnya TIDAK ikut diubah — label/angka/badge/sub tetap dipaksa
// `text-white` lewat prop `hero`. Hasilnya: teks putih di atas kartu PUTIH,
// tidak terbaca sama sekali. Sekarang `hero` hanya memberi TINT LATAR lembut
// (bg-blue-50) sebagai penanda "ini KPI utama tab ini", teksnya SELALU warna
// gelap normal — tidak ada cabang warna teks terpisah lagi.
export default function KpiCard({
  label, numericValue, format, growth, compareLabel, sparkline, hero = false, sub, index = 0, tooltip,
}) {
  const animated = useCountUp(numericValue);
  const displayValue = format ? format(animated) : Math.round(animated).toLocaleString("id-ID");

  const hasGrowth = growth !== undefined && growth !== null;
  const GrowthIcon = growth > 0 ? TrendingUp : growth < 0 ? TrendingDown : Minus;
  const growthLabel = `${growth > 0 ? "+" : ""}${growth}%`;

  return (
    <div
      className={cn(
        "animate-fade-rise relative overflow-hidden rounded-2xl p-5 shadow-card transition-shadow duration-200 hover:shadow-popover text-ink",
        hero ? "bg-blue-50" : "bg-surface"
      )}
      style={{ animationDelay: `${index * 70}ms` }}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <p className="text-[13px] font-medium text-ink3">{label}</p>
          {tooltip && <InfoTooltip text={tooltip} />}
        </span>
        {/* Titik-tiga dekoratif SENGAJA disembunyikan saat ada tooltip —
            dua ikon kecil berdempetan di pojok kanan (⋯ dan info) terlihat
            berantakan dan tidak ada yang tahu titik-tiga itu tidak bisa diklik. */}
        {!tooltip && <MoreHorizontal size={16} className="text-ink3" />}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <p className="text-[26px] font-extrabold leading-none tabular-nums text-ink">
          {displayValue}
        </p>
        {hasGrowth && (
          <div
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold",
              growth > 0 ? "bg-greenbg text-green"
              : growth < 0 ? "bg-redbg text-red"
              : "bg-inset text-ink2"
            )}
          >
            <GrowthIcon size={11} /> {growthLabel}
          </div>
        )}
        {/* BUG YANG DIPERBAIKI (26 Agustus 2026): dulu fallback hardcode
            "vs periode sebelumnya" — tidak pernah bilang PANJANG periodenya
            (7 hari? kemarin? bulan lalu?), padahal backend sudah menghitung
            pembanding dengan panjang yang benar (buildPrevRange). Sekarang
            caller WAJIB kirim compareLabel (dari lib/dateRange.js) supaya
            teksnya selalu cocok dengan rentang tanggal yang sedang dipilih. */}
        {hasGrowth && compareLabel && (
          <span className="text-[11px] text-ink3">{compareLabel}</span>
        )}
      </div>

      {sub && (
        <p className="mt-1 text-xs text-ink3">{sub}</p>
      )}

      {sparkline && sparkline.length >= 2 && (
        <div className="-mx-1 mt-3">
          <Sparkline data={sparkline} color="var(--accent)" solid={false} />
        </div>
      )}
    </div>
  );
}
