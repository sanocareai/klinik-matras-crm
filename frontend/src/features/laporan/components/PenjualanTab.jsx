import React, { useMemo } from "react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import dayjs from "dayjs";
import { formatRupiah, formatRupiahShort } from "@/utils/format.js";
import { formatTanggalPendek } from "@/utils/formatDate.js";
import KpiCard from "./KpiCard.jsx";
import ChartCard from "./ChartCard.jsx";
import ChartTooltip from "./ChartTooltip.jsx";

const AXIS_STYLE = { fontSize: 12, fill: "var(--text-secondary)" };

// Rata-rata bergerak — jendelanya mengikuti GRANULARITAS deret: 7 titik kalau
// harian (rata-rata mingguan, meredam lonjakan satu hari), 3 titik kalau
// bulanan. Dulu tab ini terkunci di data BULANAN dari /analytics/overview yang
// MENGABAIKAN rentang tanggal — di rentang 30 hari hasilnya satu batang, dan
// grafiknya bertentangan dengan header "Periode: ..." di halaman yang sama.
// Sekarang memakai `series` adaptif dari /business-summary (harian <= 92 hari).
function withMovingAverage(series, window) {
  return series.map((row, i) => {
    const slice = series.slice(Math.max(0, i - window + 1), i + 1);
    const avg = slice.reduce((s, r) => s + (r.value || 0), 0) / slice.length;
    return { ...row, ma: Math.round(avg) };
  });
}

export default function PenjualanTab({ overview, summary }) {
  const series = summary?.revenueSeries || [];
  const gran   = summary?.granularity || "day";
  const window = gran === "day" ? 7 : 3;

  const avgPerOrder = summary?.uang?.aov
    ?? ((overview?.totalOrders || 0) > 0
      ? Math.round((overview.totalOrderValue || 0) / overview.totalOrders)
      : 0);
  const chartData = useMemo(() => withMovingAverage(series, window), [series, window]);
  const labelMA = gran === "day" ? `${window} hari` : `${window} bulan`;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard index={0} label="Total Order" numericValue={overview?.totalOrders || 0} />
        <KpiCard
          index={1} hero label="Nilai Penjualan"
          numericValue={summary?.uang?.grossValue ?? overview?.totalOrderValue ?? 0}
          format={(v) => formatRupiah(Math.round(v))}
          growth={overview?.growthOrderValue}
          sparkline={series.slice(-7).map((p) => ({ value: p.value }))}
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
        title="Tren Pendapatan"
        description={`Nilai order per ${gran === "day" ? "hari" : "bulan"} + rata-rata bergerak ${labelMA}`}
        empty={series.length === 0 ? "Belum ada data pada periode ini." : null}
        index={4}
      >
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
            <defs>
              <linearGradient id="salesBarFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" />
                <stop offset="100%" stopColor="var(--accent)" />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="4 4" stroke="var(--hairline)" vertical={false} />
            <XAxis
              dataKey="bucket"
              tickFormatter={(v) => (gran === "day" ? dayjs(v).format("D MMM") : v)}
              tick={AXIS_STYLE} axisLine={false} tickLine={false}
              interval="preserveStartEnd" minTickGap={28}
            />
            <YAxis tickFormatter={formatRupiahShort} tick={AXIS_STYLE} axisLine={false} tickLine={false} width={64} />
            <Tooltip
              content={<ChartTooltip
                formatter={(v, n) => [formatRupiah(v), n === "ma" ? `Rata-rata ${labelMA}` : "Pendapatan"]}
                labelFormatter={(v) => (gran === "day" ? formatTanggalPendek(v) : v)}
              />}
              cursor={{ fill: "var(--bg-inset)" }}
            />
            <Bar dataKey="value" name="value" fill="url(#salesBarFill)" radius={[6, 6, 0, 0]} maxBarSize={44} isAnimationActive animationDuration={700} />
            <Line dataKey="ma" name="ma" type="monotone" stroke="var(--accent)" strokeWidth={2.5} dot={false} isAnimationActive animationDuration={700} />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}
