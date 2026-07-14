import React from "react";
import { TrendingUp, TrendingDown, Minus, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils.js";
import { useCountUp } from "@/hooks/useCountUp.js";
import Sparkline from "./Sparkline.jsx";

// KPI card Laporan Analitik — gaya dashboard SaaS modern (referensi:
// Ultraleads/Edaca): card putih bersih dgn border tipis, 1 "hero" card
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
        "animate-fade-rise relative overflow-hidden rounded-2xl p-5 shadow-sm transition-shadow duration-200 hover:shadow-md",
        hero
          ? "bg-gradient-to-br from-brand-900 via-brand-800 to-brand-700 text-white"
          : "border border-slate-100 bg-white text-slate-800"
      )}
      style={{ animationDelay: `${index * 70}ms` }}
    >
      <div className="flex items-start justify-between gap-2">
        <p className={cn(
          "text-[13px] font-medium",
          hero ? "text-white/70" : "text-slate-400"
        )}>
          {label}
        </p>
        <MoreHorizontal size={16} className={hero ? "text-white/50" : "text-slate-300"} />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <p className={cn("text-[26px] font-extrabold leading-none tabular-nums", hero ? "text-white" : "text-slate-800")}>
          {displayValue}
        </p>
        {hasGrowth && (
          <div
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold",
              hero
                ? "bg-white/15 text-white"
                : growth > 0 ? "bg-chart-green-soft text-chart-green"
                : growth < 0 ? "bg-chart-rose-soft text-chart-rose"
                : "bg-slate-100 text-slate-500"
            )}
          >
            <GrowthIcon size={11} /> {growthLabel}
          </div>
        )}
      </div>

      {(sub || hasGrowth) && (
        <p className={cn("mt-1 text-xs", hero ? "text-white/60" : "text-slate-400")}>
          {sub || "vs periode sebelumnya"}
        </p>
      )}

      {sparkline && sparkline.length >= 2 && (
        <div className="-mx-1 mt-3">
          <Sparkline data={sparkline} color={hero ? "#ffffff" : "#2064B7"} solid={hero} />
        </div>
      )}
    </div>
  );
}
