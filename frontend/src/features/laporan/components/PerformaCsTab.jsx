import React, { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Download } from "lucide-react";
import Avatar from "../../../components/Avatar.jsx";
import { formatRupiah, formatDuration } from "@/utils/format.js";
import KpiCard from "./KpiCard.jsx";
import ChartCard from "./ChartCard.jsx";
import ChartTooltip from "./ChartTooltip.jsx";

// Warna progress bar target — SAMA PERSIS dgn threshold lama (belum
// diset abu-abu, >=100 hijau, >=50 biru brand, di bawahnya oranye),
// cuma dipetakan ke kelas Tailwind instead of hex inline.
function progressBarClass(pct) {
  if (pct == null) return "bg-slate-300";
  if (pct >= 100) return "bg-chart-green";
  if (pct >= 50) return "bg-brand-600";
  return "bg-chart-orange";
}
function progressTextClass(pct) {
  if (pct == null) return "text-slate-400";
  if (pct >= 100) return "bg-chart-green-soft text-chart-green";
  if (pct >= 50) return "bg-brand-50 text-brand-700";
  return "bg-chart-orange-soft text-chart-orange";
}

export default function PerformaCsTab({ csPerf, targetMap, onExport }) {
  const totals = useMemo(() => ({
    conversations: csPerf.reduce((s, r) => s + (r.totalConversations || 0), 0),
    orderValue: csPerf.reduce((s, r) => s + (r.totalOrderValue || 0), 0),
    avgClosing: csPerf.length > 0
      ? Math.round(csPerf.reduce((s, r) => s + (r.closingRate || 0), 0) / csPerf.length)
      : 0,
  }), [csPerf]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex justify-end">
        <button className="btn btn-ghost btn-sm" onClick={onExport}>
          <Download size={14} /> Export Excel
        </button>
      </div>

      {csPerf.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard index={0} label="Anggota Tim Aktif" numericValue={csPerf.length} />
          <KpiCard index={1} label="Total Percakapan" numericValue={totals.conversations} />
          <KpiCard
            index={2} hero label="Total Nilai Order"
            numericValue={totals.orderValue}
            format={(v) => formatRupiah(Math.round(v))}
          />
          <KpiCard
            index={3} label="Rata-rata Closing Rate"
            numericValue={totals.avgClosing}
            format={(v) => `${Math.round(v)}%`}
            sub="di seluruh tim"
          />
        </div>
      )}

      <ChartCard
        index={4}
        title="Leaderboard Sales"
        description="Performa & progress target bulanan per anggota"
        empty={csPerf.length === 0 ? "Belum ada data performa CS pada periode ini." : null}
      >
        <div className="flex flex-col divide-y divide-slate-100">
          {csPerf.map((row) => {
            const sp = targetMap[row.userId];
            const target = sp?.target ?? 0;
            const pct = sp?.percentToTarget ?? null;
            return (
              <div key={row.userId} className="flex flex-col gap-3 py-3.5 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:gap-4">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <Avatar name={row.name} src={row.avatarUrl} size="md" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-700">{row.name}</p>
                    <p className="text-xs text-slate-400">{row.totalConversations || 0} percakapan · {formatDuration(row.avgResponseMinutes)}</p>
                  </div>
                </div>

                <div className={`inline-flex w-fit items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${
                  (row.closingRate || 0) >= 50 ? "bg-chart-green-soft text-chart-green" : "bg-chart-orange-soft text-chart-orange"
                }`}>
                  {row.closingRate != null ? `${row.closingRate}%` : "—"} closing
                </div>

                <div className="w-full sm:w-56">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-600">{formatRupiah(row.totalOrderValue || 0)}</span>
                    {target > 0 && <span className="text-slate-400">/ {formatRupiah(target)}</span>}
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full transition-[width] duration-700 ease-out ${progressBarClass(pct)}`}
                      style={{ width: `${Math.min(pct ?? 0, 100)}%` }}
                    />
                  </div>
                  <span className={`mt-1 inline-block rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${progressTextClass(pct)}`}>
                    {pct != null ? `${pct}% dari target` : "Target belum diset"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </ChartCard>

      {csPerf.length > 0 && (
        <ChartCard title="Percakapan per CS" index={5}>
          <ResponsiveContainer width="100%" height={Math.max(180, csPerf.length * 44)}>
            <BarChart data={csPerf} layout="vertical" margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="csBarFill" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#2064B7" />
                  <stop offset="100%" stopColor="#4F97E3" />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 12, fill: "#64748b" }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: "#64748b" }} width={100} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTooltip formatter={(v) => [v, "Percakapan"]} />} cursor={{ fill: "#f1f5f9" }} />
              <Bar dataKey="totalConversations" name="Percakapan" fill="url(#csBarFill)" radius={[0, 8, 8, 0]} isAnimationActive animationDuration={700} maxBarSize={22} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )}
    </div>
  );
}
