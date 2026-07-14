import React, { useMemo } from "react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { formatRupiah, labelBulan } from "@/utils/format.js";
import KpiCard from "./KpiCard.jsx";
import ChartCard from "./ChartCard.jsx";
import ChartTooltip from "./ChartTooltip.jsx";
import { buildSparkline } from "../utils.js";

const AXIS_STYLE = { fontSize: 12, fill: "#64748b" };
const MA_WINDOW = 3;

// Rata-rata bergerak N-bulan — endpoint /analytics/overview cuma balikin
// granularitas BULANAN (bukan harian), jadi "7-hari moving average" dari
// spec desain diadaptasi jadi rata-rata bergerak N-BULAN memakai data yang
// memang tersedia, bukan data harian palsu/dummy.
function withMovingAverage(series, window = MA_WINDOW) {
  return series.map((row, i) => {
    const slice = series.slice(Math.max(0, i - window + 1), i + 1);
    const avg = slice.reduce((s, r) => s + (r.value || 0), 0) / slice.length;
    return { ...row, ma: Math.round(avg) };
  });
}

export default function PenjualanTab({ overview, monthlyRevenue }) {
  const avgPerOrder = (overview?.totalOrders || 0) > 0
    ? Math.round((overview.totalOrderValue || 0) / overview.totalOrders)
    : 0;
  const chartData = useMemo(() => withMovingAverage(monthlyRevenue), [monthlyRevenue]);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard index={0} label="Total Order" numericValue={overview?.totalOrders || 0} />
        <KpiCard
          index={1} hero label="Nilai Penjualan"
          numericValue={overview?.totalOrderValue || 0}
          format={(v) => formatRupiah(Math.round(v))}
          growth={overview?.growthOrderValue}
          sparkline={buildSparkline(monthlyRevenue, "value")}
        />
        <KpiCard
          index={2} label="Rata-rata per Order"
          numericValue={avgPerOrder}
          format={(v) => (avgPerOrder > 0 ? formatRupiah(Math.round(v)) : "—")}
          sub="per transaksi"
        />
        <KpiCard index={3} label="Pelanggan Bertransaksi" numericValue={overview?.customersWithOrders || 0} />
      </div>

      <ChartCard
        title="Tren Pendapatan Bulanan"
        description={`Nilai order per bulan + rata-rata bergerak ${MA_WINDOW} bulan`}
        empty={monthlyRevenue.length === 0 ? "Belum ada data." : null}
        index={4}
      >
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
            <defs>
              <linearGradient id="salesBarFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#4F97E3" />
                <stop offset="100%" stopColor="#2064B7" />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="month" tickFormatter={labelBulan} tick={AXIS_STYLE} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={(v) => `${(v / 1_000_000).toFixed(0)}jt`} tick={AXIS_STYLE} axisLine={false} tickLine={false} />
            <Tooltip
              content={<ChartTooltip formatter={(v, n) => [formatRupiah(v), n === "ma" ? `Rata-rata ${MA_WINDOW} bulan` : "Pendapatan"]} labelFormatter={labelBulan} />}
              cursor={{ fill: "#f1f5f9" }}
            />
            <Bar dataKey="value" name="value" fill="url(#salesBarFill)" radius={[8, 8, 0, 0]} maxBarSize={44} isAnimationActive animationDuration={700} />
            <Line dataKey="ma" name="ma" type="monotone" stroke="#7c3aed" strokeWidth={2.5} dot={false} isAnimationActive animationDuration={700} />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}
