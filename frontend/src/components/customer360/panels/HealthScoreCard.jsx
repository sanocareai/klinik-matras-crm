import React from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Card } from "@/components/ui/card.jsx";
import { Badge } from "@/components/ui/badge.jsx";

const ACCENT = { success: "#16a34a", warning: "#f59e0b", danger: "#dc2626" };
const TREND = {
  up:   { Icon: TrendingUp,   cls: "text-chart-green" },
  down: { Icon: TrendingDown, cls: "text-chart-rose" },
  flat: { Icon: Minus,        cls: "text-slate-400" },
};

function Ring({ score, color }) {
  const dash = Math.max(0, Math.min(100, score));
  return (
    <span className="relative flex h-16 w-16 shrink-0 items-center justify-center">
      <svg className="absolute inset-0 -rotate-90" viewBox="0 0 36 36">
        <circle cx="18" cy="18" r="15.9" fill="none" stroke="#eef2f7" strokeWidth="4" />
        <circle cx="18" cy="18" r="15.9" fill="none" stroke={color} strokeWidth="4" strokeDasharray={`${dash} 100`} strokeLinecap="round" />
      </svg>
      <span className="text-[18px] font-bold tabular-nums" style={{ color }}>{score}</span>
    </span>
  );
}

// Customer Health Score — rule-based, explainable, VISUAL PROMINENT (aksen warna
// kategori + ring besar + arah tren bila ada). Bukan AI, tanpa false precision.
export default function HealthScoreCard({ health }) {
  if (!health) return null;
  const color = ACCENT[health.variant] || ACCENT.warning;
  const tr = health.trend ? TREND[health.trend] : null;

  return (
    <Card className="overflow-hidden">
      {/* Aksen atas berwarna kategori — menaikkan bobot visual */}
      <div className="h-1" style={{ background: color }} />
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-bold text-slate-900">Customer Score</span>
          {tr && (
            <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${tr.cls}`}>
              <tr.Icon size={13} /> {health.trendLabel}
            </span>
          )}
        </div>

        <div className="flex items-center gap-4">
          <Ring score={health.score} color={color} />
          <div>
            <Badge variant={health.variant} className="text-[12px]">{health.category}</Badge>
            <div className="mt-1.5 text-[11px] text-slate-400">Skor rule-based · transparan</div>
          </div>
        </div>

        {health.signals.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {health.signals.map((s, i) => (
              <span
                key={i}
                className={`rounded-md px-1.5 py-0.5 text-[10.5px] font-medium ${
                  s.type === "positive" ? "bg-chart-green-soft text-chart-green" : "bg-chart-rose-soft text-chart-rose"
                }`}
              >
                {s.type === "positive" ? "+" : "−"} {s.label}
              </span>
            ))}
          </div>
        ) : (
          <div className="text-[12px] text-slate-400">Belum ada sinyal cukup untuk skor.</div>
        )}
      </div>
    </Card>
  );
}
