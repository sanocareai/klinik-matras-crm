import React from "react";
import { AreaChart, Area, ResponsiveContainer } from "recharts";

// Mini trend 7-titik di dalam KpiCard — HANYA dekoratif (tanpa axis/tooltip),
// data diturunkan dari series bulanan yang sudah di-fetch (bukan endpoint
// baru), lihat KpiCard.jsx pemanggilnya.
export default function Sparkline({ data, color = "#ffffff", solid = false }) {
  if (!data || data.length < 2) return null;
  const gradId = `spark-${color.replace("#", "")}-${solid ? "s" : "o"}`;
  return (
    <ResponsiveContainer width="100%" height={36}>
      <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={solid ? 0.55 : 0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={1.75}
          fill={`url(#${gradId})`}
          isAnimationActive
          animationDuration={600}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
