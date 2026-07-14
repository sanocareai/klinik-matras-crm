import React from "react";
import { TrendingUp, AlertTriangle } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { labelBulan, formatRupiahShort } from "../../../utils/format.js";

// Tren Revenue — area chart bulanan (brand blue, isian gradient lembut).
export default function RevenueTrend({ data, loading, error }) {
  const rows = (Array.isArray(data) ? data : []).map((d) => ({ label: labelBulan(d?.month), value: d?.value || 0 }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tren Revenue</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="skeleton" style={{ height: 220, borderRadius: 12 }} />
        ) : error ? (
          <EmptyState icon={AlertTriangle} title="Gagal memuat" description="Tidak bisa memuat tren revenue." />
        ) : rows.length === 0 ? (
          <EmptyState icon={TrendingUp} title="Belum ada data" description="Belum ada penjualan pada periode ini." />
        ) : (
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={rows} margin={{ top: 5, right: 8, left: -12, bottom: 0 }}>
                <defs>
                  <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2064B7" stopOpacity={0.24} />
                    <stop offset="100%" stopColor="#2064B7" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <YAxis
                  tick={{ fontSize: 11, fill: "#94a3b8" }}
                  axisLine={false}
                  tickLine={false}
                  width={52}
                  tickFormatter={(v) => formatRupiahShort(v)}
                />
                <Tooltip
                  formatter={(v) => [formatRupiahShort(v), "Revenue"]}
                  contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12, boxShadow: "0 4px 16px rgba(15,23,42,0.1)" }}
                />
                <Area type="monotone" dataKey="value" stroke="#2064B7" strokeWidth={2} fill="url(#revFill)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
