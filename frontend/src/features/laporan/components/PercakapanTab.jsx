import React from "react";
import { formatDuration } from "@/utils/format.js";
import KpiCard from "./KpiCard.jsx";
import ChartCard from "./ChartCard.jsx";

const CHANNEL_LABEL = { WHATSAPP: "WhatsApp", INSTAGRAM: "Instagram" };
const CHANNEL_COLOR = { WHATSAPP: "bg-chart-green", INSTAGRAM: "bg-chart-violet" };
const STATUS_COLOR = {
  OPEN: "bg-brand-500", PENDING: "bg-chart-orange", RESOLVED: "bg-chart-green",
};
const STATUS_LABEL = { OPEN: "Terbuka", PENDING: "Pending", RESOLVED: "Selesai" };

export default function PercakapanTab({ perf, channelBreakdown }) {
  const statusBreakdown = perf?.statusBreakdown || [];
  const totalStatus = statusBreakdown.reduce((s, r) => s + (r.count || 0), 0);
  const totalChannel = channelBreakdown.reduce((s, r) => s + (r.count || 0), 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard index={0} label="Total Percakapan" numericValue={perf?.totalConversations || 0} />
        <KpiCard index={1} label="Terbuka" numericValue={perf?.openCount || 0} />
        <KpiCard
          index={2} hero label="Avg Response Time"
          numericValue={perf?.avgResponseMinutes || 0}
          format={() => formatDuration(perf?.avgResponseMinutes)}
          sub="waktu respons rata-rata"
        />
        <KpiCard index={3} label="Selesai" numericValue={perf?.resolvedCount || 0} sub="percakapan selesai" />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <ChartCard index={4} title="Breakdown Channel" description="Asal percakapan masuk" empty={channelBreakdown.length === 0 ? "Belum ada data." : null}>
          {/* Stacked bar ringan (bukan recharts) — cuma 1-2 kategori,
              cukup pakai div proporsional + animasi width, lebih ringan
              dari chart penuh untuk kasus sesederhana ini. */}
          <div className="flex h-3 overflow-hidden rounded-full bg-slate-100">
            {channelBreakdown.map((row) => (
              <div
                key={row.channel}
                className={`h-full transition-[width] duration-700 ease-out ${CHANNEL_COLOR[row.channel] || "bg-brand-500"}`}
                style={{ width: `${totalChannel > 0 ? (row.count / totalChannel) * 100 : 0}%` }}
              />
            ))}
          </div>
          <div className="mt-4 flex flex-col gap-2">
            {channelBreakdown.map((row) => (
              <div key={row.channel} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5">
                <span className="flex items-center gap-2 text-sm font-medium text-slate-600">
                  <span className={`h-2.5 w-2.5 rounded-full ${CHANNEL_COLOR[row.channel] || "bg-brand-500"}`} />
                  {CHANNEL_LABEL[row.channel] || row.channel}
                </span>
                <span className="text-lg font-bold text-slate-800">{row.count}</span>
              </div>
            ))}
          </div>
        </ChartCard>

        <ChartCard index={5} title="Status Percakapan" description="Terbuka / Pending / Selesai" empty={statusBreakdown.length === 0 ? "Belum ada data." : null}>
          <div className="flex h-3 overflow-hidden rounded-full bg-slate-100">
            {statusBreakdown.map((row) => (
              <div
                key={row.status}
                className={`h-full transition-[width] duration-700 ease-out ${STATUS_COLOR[row.status] || "bg-brand-500"}`}
                style={{ width: `${totalStatus > 0 ? (row.count / totalStatus) * 100 : 0}%` }}
              />
            ))}
          </div>
          <div className="mt-4 flex flex-col gap-2">
            {statusBreakdown.map((row) => (
              <div key={row.status} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5">
                <span className="flex items-center gap-2 text-sm font-medium text-slate-600">
                  <span className={`h-2.5 w-2.5 rounded-full ${STATUS_COLOR[row.status] || "bg-brand-500"}`} />
                  {STATUS_LABEL[row.status] || row.status}
                </span>
                <span className="text-lg font-bold text-slate-800">{row.count}</span>
              </div>
            ))}
          </div>
        </ChartCard>
      </div>
    </div>
  );
}
