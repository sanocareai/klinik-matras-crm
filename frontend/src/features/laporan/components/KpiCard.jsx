import React from "react";
import { TrendingUp, TrendingDown, Minus, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils.js";
import { useCountUp } from "@/hooks/useCountUp.js";
import Sparkline from "./Sparkline.jsx";

// KPI card Laporan Analitik — gaya dashboard SaaS modern (referensi:
// Ultraleads/Edaca): card bersih TANPA border (DS v2), 1 "hero" card
// per tab gradient navy gelap solid, label+titik menu "..." (dekoratif)
// di baris atas, angka besar + badge delta SEJAJAR di baris yang sama
// (bukan bertumpuk), sparkline mini opsional di bawah.
export default function KpiCard({
  label, numericValue, format, growth, sparkline, hero = false, sub, index = 0,
}) {
  const animated = useCountUp(numericValue);
  const displayValue = format ? format(animated) : Math.round(animated).toLocaleString("id-ID");

  const hasGrowth = growth !== undefined && growth !== null;
  const GrowthIcon = growth > 0 ? TrendingUp : growth < 0 ? TrendingDown : Minus;
  const growthLabel = `${growth > 0 ? "+" : ""}${growth}%`;

  return (
    <div
      className={cn(
        "animate-fade-rise relative overflow-hidden rounded-2xl p-5 shadow-card transition-shadow duration-200 hover:shadow-popover",
        // DS v2: kartu hero TIDAK lagi berlatar gradient navy. Permukaannya
        // sama dengan kartu sebelahnya — emphasis dibawa ukuran angkanya.
        "bg-surface text-ink"
      )}
      style={{ animationDelay: `${index * 70}ms` }}
    >
      <div className="flex items-start justify-between gap-2">
        <p className={cn(
          "text-[13px] font-medium",
          hero ? "text-white/70" : "text-ink3"
        )}>
          {label}
        </p>
        <MoreHorizontal size={16} className={hero ? "text-white/50" : "text-ink3"} />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <p className={cn("text-[26px] font-extrabold leading-none tabular-nums", hero ? "text-white" : "text-ink")}>
          {displayValue}
        </p>
        {hasGrowth && (
          <div
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold",
              hero
                ? "bg-surface/15 text-white"
                : growth > 0 ? "bg-greenbg text-green"
                : growth < 0 ? "bg-redbg text-red"
                : "bg-inset text-ink2"
            )}
          >
            <GrowthIcon size={11} /> {growthLabel}
          </div>
        )}
      </div>

      {(sub || hasGrowth) && (
        <p className={cn("mt-1 text-xs", hero ? "text-white/60" : "text-ink3")}>
          {sub || "vs periode sebelumnya"}
        </p>
      )}

      {sparkline && sparkline.length >= 2 && (
        <div className="-mx-1 mt-3">
          <Sparkline data={sparkline} color={hero ? "var(--bg-surface)" : "var(--accent)"} solid={hero} />
        </div>
      )}
    </div>
  );
}
