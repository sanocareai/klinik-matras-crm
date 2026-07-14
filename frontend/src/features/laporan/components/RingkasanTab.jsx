import React from "react";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { formatRupiah, labelBulan } from "@/utils/format.js";
import KpiCard from "./KpiCard.jsx";
import ChartCard from "./ChartCard.jsx";
import ChartTooltip from "./ChartTooltip.jsx";
import { buildSparkline } from "../utils.js";

const CHANNEL_LABEL = { WHATSAPP: "WhatsApp", INSTAGRAM: "Instagram" };
const CHANNEL_COLOR = { WHATSAPP: "var(--color-chart-green)", INSTAGRAM: "var(--color-chart-violet)" };

const AXIS_STYLE = { fontSize: 12, fill: "#64748b" };

export default function RingkasanTab({ overview, perf, monthlyRevenue, monthlyCustomers, channelBreakdown }) {
  const totalChannel = channelBreakdown.reduce((s, c) => s + (c.count || 0), 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          index={0}
          label="Pelanggan Baru"
          numericValue={overview?.newCustomers || 0}
          growth={overview?.growthCustomers}
          sparkline={buildSparkline(monthlyCustomers, "count")}
        />
        <KpiCard
          index={1}
          label="Total Order"
          numericValue={overview?.totalOrders || 0}
          growth={overview?.growthOrders}
        />
        <KpiCard
          index={2}
          hero
          label="Nilai Penjualan"
          numericValue={overview?.totalOrderValue || 0}
          format={(v) => formatRupiah(Math.round(v))}
          growth={overview?.growthOrderValue}
          sparkline={buildSparkline(monthlyRevenue, "value")}
        />
        <KpiCard
          index={3}
          label="Closing Rate"
          numericValue={perf?.closingRate ?? 0}
          format={(v) => (perf?.closingRate != null ? `${Math.round(v)}%` : "—")}
          sub="percakapan selesai / total"
        />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[2fr_1fr]">
        <ChartCard
          index={4}
          title="Pendapatan Bulanan"
          description="Total nilai order per bulan"
          empty={monthlyRevenue.length === 0 ? "Belum ada data." : null}
        >
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={monthlyRevenue} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
              <defs>
                <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#2064B7" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#2064B7" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="month" tickFormatter={labelBulan} tick={AXIS_STYLE} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={(v) => `${(v / 1_000_000).toFixed(0)}jt`} tick={AXIS_STYLE} axisLine={false} tickLine={false} />
              <Tooltip
                content={<ChartTooltip formatter={(v) => [formatRupiah(v), "Pendapatan"]} labelFormatter={labelBulan} />}
              />
              <Area
                type="monotone" dataKey="value" stroke="#2064B7" strokeWidth={2.5}
                fill="url(#revenueFill)" isAnimationActive animationDuration={700}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          index={5}
          title="Channel Masuk"
          description="Sumber percakapan masuk"
          empty={channelBreakdown.length === 0 ? "Belum ada data." : null}
        >
          <div className="relative">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={channelBreakdown} dataKey="count" nameKey="channel"
                  cx="50%" cy="50%" innerRadius={56} outerRadius={78}
                  paddingAngle={3} cornerRadius={8}
                  isAnimationActive animationDuration={700}
                >
                  {channelBreakdown.map((e) => (
                    <Cell key={e.channel} fill={CHANNEL_COLOR[e.channel] || "#2064B7"} stroke="none" />
                  ))}
                </Pie>
                <Tooltip content={<ChartTooltip formatter={(v, n) => [v, CHANNEL_LABEL[n] || n]} />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-extrabold text-slate-800">{totalChannel}</span>
              <span className="text-[11px] text-slate-400">percakapan</span>
            </div>
          </div>
          <div className="mt-3 flex flex-col gap-1.5">
            {channelBreakdown.map((row) => (
              <div key={row.channel} className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 text-slate-500">
                  <span className="h-2 w-2 rounded-full" style={{ background: CHANNEL_COLOR[row.channel] || "#2064B7" }} />
                  {CHANNEL_LABEL[row.channel] || row.channel}
                </span>
                <span className="font-semibold text-slate-700">{row.count}</span>
              </div>
            ))}
          </div>
        </ChartCard>
      </div>

      <ChartCard
        index={6}
        title="Pelanggan Baru per Bulan"
        empty={monthlyCustomers.length === 0 ? "Belum ada data." : null}
      >
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={monthlyCustomers} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
            <defs>
              <linearGradient id="customersFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#4F97E3" />
                <stop offset="100%" stopColor="#2064B7" />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="month" tickFormatter={labelBulan} tick={AXIS_STYLE} axisLine={false} tickLine={false} />
            <YAxis tick={AXIS_STYLE} axisLine={false} tickLine={false} />
            <Tooltip content={<ChartTooltip formatter={(v) => [v, "Pelanggan Baru"]} labelFormatter={labelBulan} />} cursor={{ fill: "#f1f5f9" }} />
            <Bar dataKey="count" fill="url(#customersFill)" radius={[8, 8, 0, 0]} isAnimationActive animationDuration={700} maxBarSize={48} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}
