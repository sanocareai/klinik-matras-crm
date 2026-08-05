import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { TrendingUp, TrendingDown } from "lucide-react";
import dayjs from "dayjs";
import SectionCard from "@/components/ui/section-card.jsx";
import { Skeleton } from "@/components/ui/skeleton.jsx";
import { api } from "@/api.js";
import { formatRupiah, formatRupiahShort } from "@/utils/format.js";
import { toApiParams, formatRangeText } from "@/lib/dateRange.js";
import { formatTanggalPendek } from "@/utils/formatDate.js";
import { cn } from "@/lib/utils.js";

function ChartTip({ active, payload, label, granularity }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-btn bg-surface px-3 py-2 shadow-popover">
      <p className="t-caption mb-1">
        {granularity === "day" ? formatTanggalPendek(label) : label}
      </p>
      <p className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
        <span className="h-2 w-2 rounded-full bg-blue-600" />
        {formatRupiah(payload[0].value)}
      </p>
    </div>
  );
}

// ─── SALES OVERVIEW ──────────────────────────────────────────────────────────
// BUG LAMA YANG DIPERBAIKI (masih relevan): kartu ini dulu memakai
// `monthlyRevenue` dari /overview — selalu 6 bulan terakhir, mengabaikan
// rentang, dan di produksi hanya berisi SATU titik. Sekarang memakai
// /analytics/revenue-series yang memberi titik HARIAN.
//
// DS v2.4: pemilih periode SENDIRI (segmented "7 hari/30 hari/3 bulan")
// DIHAPUS. Kartu ini sekarang mengikuti SATU date picker di header Dashboard
// lewat prop `range` — sama seperti Deal Pipeline & Top Performing Reps.
// Sebelumnya memilih tanggal di satu kartu TIDAK mengubah kartu lain, padahal
// ketiganya menampilkan data tentang "periode yang sama" di mata pengguna.
export default function RevenueOverview({ range, className }) {
  const params = useMemo(() => toApiParams(range), [range]);

  const q = useQuery({
    queryKey: ["revenue-series", params],
    queryFn: () => api.getRevenueSeries(params),
    staleTime: 60_000,
  });

  const points = q.data?.points || [];
  const granularity = q.data?.granularity || "day";
  const total = q.data?.total || 0;
  const totalOrders = q.data?.totalOrders || 0;
  const aov = q.data?.aov || 0;

  // Delta = separuh akhir vs separuh awal rentang. Dihitung di frontend dari
  // deret yang SUDAH ada, bukan request kedua — cukup akurat untuk indikator
  // arah, dan tidak menambah beban query.
  const delta = useMemo(() => {
    if (points.length < 4) return null;
    const tengah = Math.floor(points.length / 2);
    const awal = points.slice(0, tengah).reduce((s, p) => s + p.value, 0);
    const akhir = points.slice(tengah).reduce((s, p) => s + p.value, 0);
    if (awal === 0) return null;
    return ((akhir - awal) / awal) * 100;
  }, [points]);

  const naik = delta != null && delta >= 0;
  const Arrow = naik ? TrendingUp : TrendingDown;

  // Label sumbu X: harian → "26 Jul", bulanan → "2026-07".
  const tickX = (v) => (granularity === "day" ? dayjs(v).format("D MMM") : v);

  return (
    <SectionCard title="Sales Overview" className={className}>
      {q.isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-9 w-48" />
          <Skeleton className="h-[220px] rounded-btn" />
        </div>
      ) : q.isError ? (
        <p className="t-secondary py-16 text-center">Gagal memuat data penjualan.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="t-caption">Total Revenue</p>
              <p className="t-metric mt-1">{formatRupiah(total)}</p>
              <div className="mt-1.5 flex flex-wrap items-baseline gap-1.5">
                {delta != null && (
                  <span className={cn(
                    "inline-flex items-center gap-0.5 text-[13px] font-semibold tabular-nums",
                    naik ? "text-green" : "text-red"
                  )}>
                    <Arrow size={13} strokeWidth={2.5} />
                    {naik ? "+" : ""}{delta.toFixed(1)}%
                  </span>
                )}
                <span className="t-secondary text-[11px]">{formatRangeText(range)}</span>
              </div>
            </div>
            {/* AOV di sini (bukan cuma di Laporan) — naik/turunnya Revenue
                di atas seringkali dijelaskan oleh AOV, bukan jumlah order. */}
            {totalOrders > 0 && (
              <div className="text-right">
                <p className="t-caption">AOV</p>
                <p className="mt-1 text-[19px] font-bold tabular-nums text-ink">{formatRupiahShort(aov)}</p>
                <p className="t-secondary mt-1 text-[11px]">{totalOrders} order</p>
              </div>
            )}
          </div>

          {total === 0 ? (
            <p className="t-secondary py-16 text-center">
              Belum ada order pada periode ini.
            </p>
          ) : (
            <div className="mt-5 -ml-1">
              <ResponsiveContainer width="100%" height={230}>
                <AreaChart data={points} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%"   stopColor="var(--blue-500)" stopOpacity={0.28} />
                      <stop offset="100%" stopColor="var(--blue-500)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="4 4" stroke="var(--hairline)" vertical={false} />
                  <XAxis
                    dataKey="bucket" tickFormatter={tickX}
                    tick={{ fontSize: 11, fill: "var(--text-tertiary)" }}
                    axisLine={false} tickLine={false} dy={6}
                    // Batasi jumlah label supaya 30 titik tidak bertumpuk.
                    interval="preserveStartEnd" minTickGap={28}
                  />
                  <YAxis
                    tickFormatter={formatRupiahShort}
                    tick={{ fontSize: 11, fill: "var(--text-tertiary)" }}
                    axisLine={false} tickLine={false}
                    // width 64 (bukan 52): "Rp220.0jt" terpotong di lebar lama.
                    width={64}
                  />
                  <Tooltip
                    content={<ChartTip granularity={granularity} />}
                    cursor={{ stroke: "var(--hairline)" }}
                  />
                  <Area
                    type="monotone" dataKey="value"
                    stroke="var(--blue-600)" strokeWidth={2.5}
                    fill="url(#revFill)"
                    // Dot disembunyikan saat titiknya banyak (harian 30+) —
                    // kalau tidak, garisnya jadi rangkaian bulatan yang ramai.
                    dot={points.length <= 14 ? { r: 3, fill: "var(--blue-600)", strokeWidth: 0 } : false}
                    activeDot={{ r: 5, fill: "var(--blue-600)", stroke: "var(--bg-surface)", strokeWidth: 2 }}
                    isAnimationActive animationDuration={700}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}
    </SectionCard>
  );
}
