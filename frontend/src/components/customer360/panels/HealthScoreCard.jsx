import React from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card.jsx";
import { Badge } from "@/components/ui/badge.jsx";

// Cincin skor + kategori. Warna = kategori (Sehat/Perlu Perhatian/Berisiko).
function Ring({ score, variant }) {
  const color = variant === "success" ? "#16a34a" : variant === "warning" ? "#f59e0b" : "#dc2626";
  const dash = Math.max(0, Math.min(100, score));
  return (
    <span className="relative flex h-14 w-14 shrink-0 items-center justify-center">
      <svg className="absolute inset-0 -rotate-90" viewBox="0 0 36 36">
        <circle cx="18" cy="18" r="15.9" fill="none" stroke="#eef2f7" strokeWidth="3.5" />
        <circle cx="18" cy="18" r="15.9" fill="none" stroke={color} strokeWidth="3.5" strokeDasharray={`${dash} 100`} strokeLinecap="round" />
      </svg>
      <span className="text-[15px] font-bold tabular-nums" style={{ color }}>{score}</span>
    </span>
  );
}

// Customer Health Score — rule-based, explainable (chip sinyal). Bukan AI.
export default function HealthScoreCard({ health }) {
  if (!health) return null;
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle>Customer Health Score</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        <div className="flex items-center gap-3">
          <Ring score={health.score} variant={health.variant} />
          <div>
            <Badge variant={health.variant}>{health.category}</Badge>
            <div className="mt-1 text-[11px] text-slate-400">Skor rule-based · transparan</div>
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
      </CardContent>
    </Card>
  );
}
