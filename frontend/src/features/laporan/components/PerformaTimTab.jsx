import React, { useMemo } from "react";
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import dayjs from "dayjs";
import { formatDuration, formatRupiah, formatRupiahShort } from "@/utils/format.js";
import { formatTanggalPendek } from "@/utils/formatDate.js";
import KpiCard from "./KpiCard.jsx";
import ChartCard from "./ChartCard.jsx";

const CHANNEL_LABEL = { WHATSAPP: "WhatsApp", INSTAGRAM: "Instagram" };
const CHANNEL_COLOR = { WHATSAPP: "bg-green", INSTAGRAM: "bg-accent" };
const STATUS_COLOR = {
  OPEN: "bg-accent", PENDING: "bg-orange", RESOLVED: "bg-green",
};
const STATUS_LABEL = { OPEN: "Terbuka", PENDING: "Pending", RESOLVED: "Selesai" };

// Tooltip gabungan revenue (batang) + avg respons (garis) — pola sama
// dengan RespTrendTip di SalesReportTab.jsx, cuma nilai batangnya Rupiah
// bukan jumlah pelanggaran SLA.
function TrenTip({ active, payload, label, granularity }) {
  if (!active || !payload?.length) return null;
  const revenue = payload.find((p) => p.dataKey === "revenue")?.value;
  const avgMinutes = payload.find((p) => p.dataKey === "avgMinutes")?.value;
  return (
    <div className="rounded-btn bg-surface px-3 py-2 shadow-popover">
      <p className="t-caption mb-1">{granularity === "day" ? formatTanggalPendek(label) : label}</p>
      <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
        <span className="h-2 w-2 rounded-full bg-accent" /> Penjualan: {formatRupiah(revenue || 0)}
      </p>
      {avgMinutes != null && (
        <p className="mt-0.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-blue-600">
          <span className="h-2 w-2 rounded-full bg-blue-600" /> Avg respons: {Math.round(avgMinutes)} mnt
        </p>
      )}
    </div>
  );
}

// ═══ PERFORMA TIM ═══════════════════════════════════════════════════════════
// Gabungan tab "Percakapan" + "Penjualan" lama (25 Agustus 2026, permintaan
// owner) — dua tab itu sama-sama "seberapa sehat operasional tim", cuma
// dipisah tampilan padahal saling menjelaskan (respons lambat vs penjualan
// turun). Chart tren gabungan di bawah ini pengganti "Avg Response Time"
// (PercakapanTab) + "Tren Pendapatan" (PenjualanTab) yang dulu terpisah dan
// menampilkan revenue series yang sama dua kali secara implisit.
export default function PerformaTimTab({ perf, overview, summary, respTimeSeries, channelBreakdown, salesReport }) {
  const statusBreakdown = perf?.statusBreakdown || [];
  const totalStatus = statusBreakdown.reduce((s, r) => s + (r.count || 0), 0);
  const totalChannel = channelBreakdown.reduce((s, r) => s + (r.count || 0), 0);

  // Revenue (business-summary) & avg respons (response-time-series) SUDAH
  // dipanggil dengan `params` yang SAMA dari Laporan.jsx → granularitas &
  // batas bucket-nya identik (keduanya pakai seriesWindow() di backend),
  // jadi aman di-zip per index tanpa join by key.
  const trenData = useMemo(() => {
    const revenuePts = summary?.revenueSeries || [];
    const avgPts = respTimeSeries?.avgResponseSeries || [];
    return revenuePts.map((p, i) => ({
      bucket: p.bucket, revenue: p.value, avgMinutes: avgPts[i]?.value ?? null,
    }));
  }, [summary, respTimeSeries]);
  const granularity = summary?.granularity || respTimeSeries?.granularity || "day";
  const tickX = (v) => (granularity === "day" ? dayjs(v).format("D MMM") : v);

  const avgPerOrder = summary?.uang?.aov
    ?? ((overview?.totalOrders || 0) > 0
      ? Math.round((overview.totalOrderValue || 0) / overview.totalOrders)
      : 0);

  // Target TIM (Novi) — kalau ada, ini KPI paling penting di tab ini karena
  // menjawab "apakah tim sedang di jalur target bulan ini", bukan cuma
  // "berapa banyak chat/order". Lihat catatan panjang di SalesReportTab.jsx
  // soal kenapa progress-nya pakai grossValue TIM, bukan grossValue pribadi
  // team lead.
  const teamLead = (salesReport?.rows || []).find((r) => r.isTeamLead);
  const teamProgress = teamLead
    ? {
        gross: teamLead.grossValue + (salesReport?.total?.grossValue || 0),
        target: teamLead.target,
      }
    : null;
  const teamPercent = teamProgress?.target > 0 ? Math.round((teamProgress.gross / teamProgress.target) * 100) : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard index={0} label="Total Percakapan" numericValue={perf?.totalConversations || 0} />
        <KpiCard
          index={1} hero label="Nilai Penjualan"
          numericValue={summary?.uang?.grossValue ?? overview?.totalOrderValue ?? 0}
          format={(v) => formatRupiah(Math.round(v))}
          growth={overview?.growthOrderValue}
          sparkline={(summary?.revenueSeries || []).slice(-7).map((p) => ({ value: p.value }))}
        />
        <KpiCard
          index={2} label="Rata-rata per Order"
          numericValue={avgPerOrder}
          format={(v) => (avgPerOrder > 0 ? formatRupiah(Math.round(v)) : "—")}
          sub="per transaksi"
        />
        {teamProgress ? (
          <KpiCard
            index={3} label="Target Tim"
            numericValue={teamPercent || 0}
            format={(v) => (teamPercent != null ? `${v}%` : "—")}
            sub={
              teamPercent != null
                ? `${formatRupiahShort(teamProgress.gross)} / ${formatRupiahShort(teamProgress.target)}`
                : "Target belum diset (Pengaturan > Target Sales)"
            }
          />
        ) : (
          <KpiCard index={3} label="Pelanggan Bertransaksi" numericValue={summary?.konversi?.customersWithOrders || 0} />
        )}
      </div>

      <ChartCard
        index={4}
        title="Tren Penjualan & Waktu Respons"
        description="Nilai penjualan (batang) & rata-rata waktu respons (garis) tim, dari waktu ke waktu — kelihatan langsung kalau respons lambat berbarengan dengan penjualan turun"
        empty={trenData.length === 0 ? "Belum ada data pada periode ini." : null}
      >
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={trenData} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
            <defs>
              <linearGradient id="performaTimBarFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" />
                <stop offset="100%" stopColor="var(--accent)" />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="4 4" stroke="var(--hairline)" vertical={false} />
            <XAxis
              dataKey="bucket" tickFormatter={tickX}
              tick={{ fontSize: 11, fill: "var(--text-tertiary)" }}
              axisLine={false} tickLine={false}
              interval="preserveStartEnd" minTickGap={28}
            />
            <YAxis
              yAxisId="rupiah" tickFormatter={formatRupiahShort}
              tick={{ fontSize: 11, fill: "var(--text-tertiary)" }}
              axisLine={false} tickLine={false} width={64}
            />
            <YAxis
              yAxisId="menit" orientation="right"
              tick={{ fontSize: 11, fill: "var(--text-tertiary)" }}
              axisLine={false} tickLine={false} width={42}
              label={{ value: "menit", angle: 90, position: "insideRight", fontSize: 10, fill: "var(--text-tertiary)" }}
            />
            <Tooltip content={<TrenTip granularity={granularity} />} cursor={{ fill: "var(--bg-inset)" }} />
            <Bar yAxisId="rupiah" dataKey="revenue" name="revenue" fill="url(#performaTimBarFill)" radius={[6, 6, 0, 0]} maxBarSize={44} isAnimationActive animationDuration={700} />
            <Line
              yAxisId="menit" type="monotone" dataKey="avgMinutes"
              stroke="var(--blue-600)" strokeWidth={2.5} dot={false}
              connectNulls={false} activeDot={{ r: 4 }} isAnimationActive animationDuration={700}
            />
          </ComposedChart>
        </ResponsiveContainer>
        <p className="mt-3 border-t border-line pt-3 text-[11px] leading-relaxed text-ink3">
          Garis respons terputus = periode tanpa data (bukan 0 menit).
        </p>
      </ChartCard>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <ChartCard index={5} title="Breakdown Channel" description="Asal percakapan masuk" empty={channelBreakdown.length === 0 ? "Belum ada data." : null}>
          <div className="flex h-3 overflow-hidden rounded-full bg-inset">
            {channelBreakdown.map((row) => (
              <div
                key={row.channel}
                className={`h-full transition-[width] duration-700 ease-out ${CHANNEL_COLOR[row.channel] || "bg-accent"}`}
                style={{ width: `${totalChannel > 0 ? (row.count / totalChannel) * 100 : 0}%` }}
              />
            ))}
          </div>
          <div className="mt-4 flex flex-col gap-2">
            {channelBreakdown.map((row) => (
              <div key={row.channel} className="flex items-center justify-between rounded-xl bg-inset px-3 py-2.5">
                <span className="flex items-center gap-2 text-sm font-medium text-ink2">
                  <span className={`h-2.5 w-2.5 rounded-full ${CHANNEL_COLOR[row.channel] || "bg-accent"}`} />
                  {CHANNEL_LABEL[row.channel] || row.channel}
                </span>
                <span className="text-lg font-bold text-ink">{row.count}</span>
              </div>
            ))}
          </div>
        </ChartCard>

        <ChartCard index={6} title="Status Percakapan" description="Terbuka / Pending / Selesai" empty={statusBreakdown.length === 0 ? "Belum ada data." : null}>
          <div className="flex h-3 overflow-hidden rounded-full bg-inset">
            {statusBreakdown.map((row) => (
              <div
                key={row.status}
                className={`h-full transition-[width] duration-700 ease-out ${STATUS_COLOR[row.status] || "bg-accent"}`}
                style={{ width: `${totalStatus > 0 ? (row.count / totalStatus) * 100 : 0}%` }}
              />
            ))}
          </div>
          <div className="mt-4 flex flex-col gap-2">
            {statusBreakdown.map((row) => (
              <div key={row.status} className="flex items-center justify-between rounded-xl bg-inset px-3 py-2.5">
                <span className="flex items-center gap-2 text-sm font-medium text-ink2">
                  <span className={`h-2.5 w-2.5 rounded-full ${STATUS_COLOR[row.status] || "bg-accent"}`} />
                  {STATUS_LABEL[row.status] || row.status}
                </span>
                <span className="text-lg font-bold text-ink">{row.count}</span>
              </div>
            ))}
          </div>
        </ChartCard>
      </div>
    </div>
  );
}
