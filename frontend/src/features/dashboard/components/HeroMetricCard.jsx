import React from "react";
import { TrendingUp, TrendingDown, ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui/card.jsx";
import { useCountUp } from "../hooks/useCountUp.js";
import { formatRupiahShort } from "../../../utils/format.js";

// Sparkline mini (inline SVG, ringan — tanpa recharts).
// DS v2: warnanya accent, bukan putih — kartu ini sudah tidak berlatar gelap.
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
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} fill="none" className="text-accent">
      <path d={d} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Kartu KPI utama (Revenue).
//
// DS v2 (spec Step 4): isian navy gelap + teks putih DIHAPUS. Kartu ini sekarang
// memakai permukaan yang SAMA dengan kartu sebelahnya — yang membedakannya
// adalah UKURAN ANGKANYA (t-metric), bukan latar berwarna. Itu inti aturannya:
// emphasis lewat tipografi & ruang, bukan lewat blok warna.
export default function HeroMetricCard({ label = "Revenue", value = 0, trend, sparkline = [], onClick }) {
  const animated = useCountUp(typeof value === "number" ? value : 0);
  const hasTrend = trend != null && Number.isFinite(trend);
  const up = hasTrend && trend >= 0;

  return (
    <Card
      className="flex min-h-[104px] flex-col justify-between gap-3"
      role={onClick ? "button" : undefined}
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="t-caption">{label}</span>
        {onClick ? <ArrowUpRight size={15} className="text-ink3" /> : <Sparkline points={sparkline} />}
      </div>
      <div>
        <div className="t-metric">{formatRupiahShort(animated)}</div>
        {hasTrend && (
          // Hijau/merah di sini adalah MAKNA (naik/turun), bukan dekorasi —
          // salah satu dari tiga warna semantik yang diizinkan.
          <div className={`mt-1.5 inline-flex items-center gap-1 text-[13px] font-medium ${up ? "text-green" : "text-red"}`}>
            {up ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
            {up ? "+" : ""}{trend.toFixed(1)}% dari periode lalu
          </div>
        )}
      </div>
    </Card>
  );
}
