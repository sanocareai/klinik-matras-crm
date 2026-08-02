import React from "react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import ChartCard from "@/features/laporan/components/ChartCard.jsx";
import ChartTooltip from "@/features/laporan/components/ChartTooltip.jsx";
import MockBadge from "./MockBadge.jsx";

// Distribusi job per status.
//
// Memakai Recharts + ChartCard + ChartTooltip yang SUDAH ADA di
// features/laporan — tidak menambah library chart baru (batasan eksplisit),
// dan tidak menulis ulang wrapper card/tooltip yang sudah punya gaya sendiri.
//
// Warna memakai CSS variable (var(--accent), var(--hairline)), bukan hex —
// ini pola yang sudah dipakai PenjualanTab.jsx, dan yang membuat chart ikut
// berubah kalau token tema diganti.
const AXIS_STYLE = { fontSize: 11, fill: "var(--text-secondary)" };

export default function JobStatusChart({ data }) {
  const kosong = !data || data.length === 0;

  return (
    <ChartCard
      title={
        <span className="flex items-center gap-2">
          Job per Status <MockBadge />
        </span>
      }
      description="Sebaran seluruh job delivery berdasarkan status terkini."
      empty={kosong ? "Belum ada job untuk ditampilkan." : null}
    >
      {!kosong && (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
            <defs>
              <linearGradient id="deliveryBarFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.95} />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.55} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="4 4" stroke="var(--hairline)" vertical={false} />
            <XAxis
              dataKey="status"
              tick={AXIS_STYLE}
              tickLine={false}
              axisLine={false}
              interval={0}
              angle={-18}
              textAnchor="end"
              height={64}
            />
            <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip
              content={<ChartTooltip formatter={(v) => `${v} job`} />}
              cursor={{ fill: "var(--bg-inset)" }}
            />
            <Bar
              dataKey="jumlah"
              name="Job"
              fill="url(#deliveryBarFill)"
              radius={[6, 6, 0, 0]}
              maxBarSize={44}
              isAnimationActive
              animationDuration={600}
            />
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}
