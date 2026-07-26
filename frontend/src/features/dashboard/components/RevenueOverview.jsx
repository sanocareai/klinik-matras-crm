import React from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { TrendingUp, TrendingDown } from "lucide-react";
import SectionCard, { FilterPill } from "@/components/ui/section-card.jsx";
import { Skeleton } from "@/components/ui/skeleton.jsx";
import { formatRupiah, formatRupiahShort, labelBulan } from "@/utils/format.js";
import { cn } from "@/lib/utils.js";

// Tooltip melayang: kartu kecil putih + titik biru + nilai — persis pola
// referensi. Dipisah jadi komponen supaya recharts tidak menyuntik gaya
// default-nya (kotak abu ber-border) yang bertabrakan dengan DS.
function ChartTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-btn bg-surface px-3 py-2 shadow-popover">
      <p className="t-caption mb-1">{labelBulan(label)}</p>
      <p className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
        <span className="h-2 w-2 rounded-full bg-blue-600" />
        {formatRupiah(payload[0].value)}
      </p>
    </div>
  );
}

// ─── SALES OVERVIEW ──────────────────────────────────────────────────────────
// Kartu terbesar & paling atas: total pendapatan + delta + area chart.
// Sesuai referensi, angka besar dan chart ada DI SATU kartu — bukan dua kartu
// terpisah — supaya angkanya langsung punya konteks bentuk kurvanya.
export default function RevenueOverview({
  total = 0, delta, series = [], periodLabel, loading, error,
}) {
  const adaDelta = delta != null && Number.isFinite(delta);
  const naik = adaDelta && delta >= 0;
  const Arrow = naik ? TrendingUp : TrendingDown;

  return (
    <SectionCard
      title="Ringkasan Penjualan"
      action={<FilterPill>{periodLabel}</FilterPill>}
    >
      {loading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-[220px] rounded-btn" />
        </div>
      ) : error ? (
        <p className="t-secondary py-10 text-center">Gagal memuat data penjualan.</p>
      ) : (
        <>
          <p className="t-caption">Total Pendapatan</p>
          <p className="t-metric mt-1">{formatRupiah(total)}</p>
          {adaDelta && (
            <p className="mt-1.5 flex items-baseline gap-1.5">
              <span className={cn(
                "inline-flex items-center gap-0.5 text-[13px] font-semibold tabular-nums",
                naik ? "text-green" : "text-red"
              )}>
                <Arrow size={13} strokeWidth={2.5} />
                {naik ? "+" : ""}{Number(delta).toFixed(1)}%
              </span>
              <span className="t-secondary text-[11px]">vs periode sebelumnya</span>
            </p>
          )}

          <div className="mt-5 -ml-2">
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  {/* Gradien isian: biru pekat di atas → transparan di bawah.
                      Memakai var() supaya ikut bertukar saat tema gelap. */}
                  <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor="var(--blue-500)" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="var(--blue-500)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="4 4" stroke="var(--hairline)" vertical={false} />
                <XAxis
                  dataKey="month" tickFormatter={labelBulan}
                  tick={{ fontSize: 11, fill: "var(--text-tertiary)" }}
                  axisLine={false} tickLine={false} dy={4}
                />
                <YAxis
                  tickFormatter={formatRupiahShort}
                  tick={{ fontSize: 11, fill: "var(--text-tertiary)" }}
                  axisLine={false} tickLine={false} width={52}
                />
                <Tooltip content={<ChartTip />} cursor={{ stroke: "var(--hairline)" }} />
                <Area
                  type="monotone" dataKey="value"
                  stroke="var(--blue-600)" strokeWidth={2.5}
                  fill="url(#revFill)"
                  // Titik data terlihat (seperti referensi) dan membesar saat
                  // hover — memberi target klik dan menegaskan granularitasnya.
                  dot={{ r: 3, fill: "var(--blue-600)", strokeWidth: 0 }}
                  activeDot={{ r: 5, fill: "var(--blue-600)", stroke: "var(--bg-surface)", strokeWidth: 2 }}
                  isAnimationActive animationDuration={700}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </SectionCard>
  );
}
