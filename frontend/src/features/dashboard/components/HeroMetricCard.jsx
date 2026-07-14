import React from "react";
import { TrendingUp, TrendingDown, ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui/card.jsx";
import { useCountUp } from "../hooks/useCountUp.js";
import { formatRupiahShort } from "../../../utils/format.js";

// Sparkline mini (inline SVG, ringan — tanpa recharts) untuk kartu hero.
function Sparkline({ points }) {
  if (!points || points.length < 2) return null;
  const w = 108, h = 32;
  const vals = points.map((p) => p.value || 0);
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const step = w / (points.length - 1);
  const d = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(h - ((p.value - min) / span) * h).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} fill="none" className="text-white/80">
      <path d={d} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Kartu KPI "hero" — SATU per view (Revenue). Gradient navy brand, teks putih,
// sparkline. Tinggi disamakan dengan MetricCard supaya baris KPI rata.
export default function HeroMetricCard({ label = "Revenue", value = 0, trend, sparkline = [], onClick }) {
  const animated = useCountUp(typeof value === "number" ? value : 0);
  const hasTrend = trend != null && Number.isFinite(trend);
  const up = hasTrend && trend >= 0;

  return (
    <Card
      variant="hero"
      className="flex min-h-[104px] flex-col justify-between p-4"
      role={onClick ? "button" : undefined}
      onClick={onClick}
    >
      <div className="flex items-start justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-white/70">{label}</span>
        {onClick ? <ArrowUpRight size={15} className="text-white/60" /> : <Sparkline points={sparkline} />}
      </div>
      <div>
        <div className="text-[26px] font-bold leading-none tracking-[-0.01em] tabular-nums">
          {formatRupiahShort(animated)}
        </div>
        {hasTrend && (
          <div className={`mt-1.5 inline-flex items-center gap-1 text-[12px] font-semibold ${up ? "text-emerald-300" : "text-rose-300"}`}>
            {up ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
            {up ? "+" : ""}{trend.toFixed(1)}% dari periode lalu
          </div>
        )}
      </div>
    </Card>
  );
}
