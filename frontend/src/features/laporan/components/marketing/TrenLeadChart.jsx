import React, { useMemo } from "react";
import { ComposedChart, Area, Line, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { TrendingUp, TrendingDown } from "lucide-react";
import dayjs from "dayjs";
import { formatTanggalPendek } from "@/utils/formatDate.js";
import { cn } from "@/lib/utils.js";
import ChartCard from "../ChartCard.jsx";

// Tren lead harian (pindahan dari tab Traffic). Sumber: GET /analytics/traffic → daily. Lead harian TANPA spam dan tanpa B2B/penjualan karyawan (definisi server);
// beda dari kartu "Total lead" yang memuat spam — selisihnya direkonsiliasi di bagian Kualitas data (rekonLead).
function TrafficTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  return (
    <div className="rounded-btn bg-surface px-3 py-2 shadow-popover">
      <p className="t-caption mb-1">{formatTanggalPendek(label)}</p>
      <p className="text-[13px] font-semibold text-ink">{p.value} lead</p>
      {p.baseline != null && (
        <p className="t-secondary mt-0.5 text-[11px]">
          Normal: {p.lower}–{p.upper} (rata-rata {p.baseline})
        </p>
      )}
      {p.partial && <p className="mt-0.5 text-[11px] text-orange">Hari berjalan — belum lengkap</p>}
      {p.status === "spike" && <p className="mt-0.5 text-[11px] font-semibold text-green">▲ Spike +{p.deltaPct}%</p>}
      {p.status === "drop" && <p className="mt-0.5 text-[11px] font-semibold text-red">▼ Drop {p.deltaPct}%</p>}
    </div>
  );
}

export default function TrenLeadChart({ traffic }) {
  const daily = traffic?.daily || [];
  const anomali = daily.filter((d) => d.status !== "normal");
  // Recharts butuh field terpisah utk menggambar pita baseline sebagai area bertumpuk (lower + tinggi pita).
  const chartData = useMemo(() => daily.map((d) => ({
    ...d,
    bandBase: d.lower ?? null,
    bandSize: d.upper != null && d.lower != null ? d.upper - d.lower : null,
    spikeDot: d.status === "spike" ? d.value : null,
    dropDot:  d.status === "drop"  ? d.value : null,
  })), [daily]);
  return (
    <ChartCard
      index={1}
      title="Tren lead harian"
      description="Lead tanpa spam, per hari (WIB). Pita abu = rentang normal (rata-rata 7 hari sebelumnya ± 2 standar deviasi); hari berjalan belum lengkap."
      empty={daily.length === 0 ? "Belum ada data lead pada periode ini." : null}
    >
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="4 4" stroke="var(--hairline)" vertical={false} />
            <XAxis
              dataKey="bucket" tickFormatter={(v) => dayjs(v).format("D MMM")}
              tick={{ fontSize: 11, fill: "var(--text-tertiary)" }}
              axisLine={false} tickLine={false} dy={6}
              interval="preserveStartEnd" minTickGap={28}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "var(--text-tertiary)" }}
              axisLine={false} tickLine={false} width={36} allowDecimals={false}
            />
            <Tooltip content={<TrafficTip />} cursor={{ stroke: "var(--hairline)" }} />
            {/* Pita normal: area transparan (offset) + area terlihat setinggi pita */}
            <Area dataKey="bandBase" stackId="band" stroke="none" fill="transparent" isAnimationActive={false} />
            <Area dataKey="bandSize" stackId="band" stroke="none" fill="var(--text-tertiary)" fillOpacity={0.13} isAnimationActive={false} />
            <Line type="monotone" dataKey="value" stroke="var(--blue-600)" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
            <Scatter dataKey="spikeDot" fill="var(--green)" shape="circle" />
            <Scatter dataKey="dropDot"  fill="var(--red)"   shape="circle" />
          </ComposedChart>
        </ResponsiveContainer>

        {anomali.length > 0 && (
          <div className="mt-3 flex flex-col gap-1.5 border-t border-line pt-3">
            {anomali.slice(-6).reverse().map((a) => (
              <div key={a.bucket} className="flex items-center gap-2 text-[12px]">
                {a.status === "spike"
                  ? <TrendingUp size={13} className="shrink-0 text-green" />
                  : <TrendingDown size={13} className="shrink-0 text-red" />}
                <span className="font-medium text-ink">{formatTanggalPendek(a.bucket)}</span>
                <span className={cn("font-semibold tabular-nums", a.status === "spike" ? "text-green" : "text-red")}>
                  {a.value} lead ({a.deltaPct > 0 ? "+" : ""}{a.deltaPct}%)
                </span>
                <span className="t-secondary text-[11px]">vs normal ±{a.baseline}</span>
              </div>
            ))}
          </div>
        )}
    </ChartCard>
  );
}
