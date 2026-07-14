import React from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils.js";
import { useCountUp } from "@/hooks/useCountUp.js";
import Sparkline from "./Sparkline.jsx";

// KPI card Laporan Analitik — gradient brand blue (atau "hero" gradient
// gelap utk 1 metrik utama per tab), angka animasi count-up, badge delta
// (+x% vs periode sebelumnya), sparkline mini 7-titik diturunkan dari
// series bulanan yang SUDAH di-fetch (bukan endpoint baru — lihat
// Laporan.jsx#buildSparkline).
export default function KpiCard({
  label, numericValue, format, growth, sparkline, hero = false, sub, index = 0,
}) {
  const animated = useCountUp(numericValue);
  const displayValue = format ? format(animated) : Math.round(animated).toLocaleString("id-ID");

  const hasGrowth = growth !== undefined && growth !== null;
  const GrowthIcon = growth > 0 ? TrendingUp : growth < 0 ? TrendingDown : Minus;
  const growthLabel = `${growth > 0 ? "+" : ""}${growth}% vs periode sebelumnya`;

  return (
    <div
      className={cn(
        "animate-fade-rise relative overflow-hidden rounded-2xl p-5 shadow-sm transition-shadow duration-200 hover:shadow-md",
        hero
          ? "bg-gradient-to-br from-brand-700 via-brand-600 to-brand-500 text-white"
          : "bg-gradient-to-br from-brand-50 to-white text-slate-800 ring-1 ring-black/5"
      )}
      style={{ animationDelay: `${index * 70}ms` }}
    >
      <p className={cn(
        "text-[11px] font-semibold uppercase tracking-wide",
        hero ? "text-white/75" : "text-slate-400"
      )}>
        {label}
      </p>
      <p className={cn("mt-1.5 text-[26px] font-extrabold leading-none tabular-nums", hero ? "text-white" : "text-slate-800")}>
        {displayValue}
      </p>
      {sub && (
        <p className={cn("mt-1.5 text-xs", hero ? "text-white/70" : "text-slate-400")}>{sub}</p>
      )}

      {hasGrowth && (
        <div
          className={cn(
            "mt-2.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold",
            hero
              ? "bg-white/15 text-white"
              : growth > 0 ? "bg-chart-green-soft text-chart-green"
              : growth < 0 ? "bg-chart-rose-soft text-chart-rose"
              : "bg-slate-100 text-slate-500"
          )}
        >
          <GrowthIcon size={12} /> {growthLabel}
        </div>
      )}

      {sparkline && sparkline.length >= 2 && (
        <div className="-mx-1 mt-3">
          <Sparkline data={sparkline} color={hero ? "#ffffff" : "#2064B7"} solid={hero} />
        </div>
      )}
    </div>
  );
}
