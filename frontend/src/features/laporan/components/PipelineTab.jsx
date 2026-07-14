import React from "react";
import { ChevronRight } from "lucide-react";
import { formatRupiah } from "@/utils/format.js";
import ChartCard from "./ChartCard.jsx";

const STAGE_GRADIENT = {
  LEAD:      "from-indigo-400 to-indigo-500",
  QUALIFIED: "from-brand-500 to-brand-600",
  QUOTED:    "from-amber-400 to-amber-500",
  WON:       "from-emerald-400 to-emerald-500",
  LOST:      "from-rose-400 to-rose-500",
};
const STAGE_DOT = {
  LEAD: "bg-indigo-500", QUALIFIED: "bg-brand-600", QUOTED: "bg-amber-500",
  WON: "bg-emerald-500", LOST: "bg-rose-500",
};

export default function PipelineTab({ funnel }) {
  const total = funnel.reduce((s, f) => s + f.count, 0);

  return (
    <div className="flex flex-col gap-5">
      <ChartCard
        title="Sales Pipeline Funnel"
        description="Jumlah pelanggan & konversi antar stage"
        empty={funnel.length === 0 ? "Belum ada data pipeline." : null}
      >
        <div className="flex flex-col gap-0 sm:flex-row sm:items-stretch sm:gap-0">
          {funnel.map((item, i) => {
            const prev = funnel[i - 1];
            const conversion = prev && prev.count > 0 ? Math.round((item.count / prev.count) * 100) : null;
            return (
              <React.Fragment key={item.stage}>
                {i > 0 && (
                  <div className="flex flex-col items-center justify-center px-1 py-2 sm:py-0">
                    <ChevronRight className="text-slate-300" size={18} />
                    {conversion != null && (
                      <span className="text-[11px] font-bold text-slate-400">{conversion}%</span>
                    )}
                  </div>
                )}
                <div
                  className={`animate-fade-rise flex-1 rounded-2xl bg-gradient-to-br p-4 shadow-sm sm:min-w-0 ${STAGE_GRADIENT[item.stage] || "from-slate-400 to-slate-500"}`}
                  style={{ animationDelay: `${i * 80}ms` }}
                >
                  <p className="text-2xl font-extrabold leading-none text-white">{item.count}</p>
                  <p className="mt-1.5 text-xs font-bold text-white/90">{item.label}</p>
                  <p className="mt-1 text-[11px] text-white/70">{formatRupiah(item.value)}</p>
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </ChartCard>

      <ChartCard title="Detail per Stage">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {["Stage", "Jumlah", "Total Nilai", "Persentase"].map((h) => (
                  <th key={h} className="border-b border-slate-100 px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-slate-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {funnel.map((item) => {
                const pct = total > 0 ? ((item.count / total) * 100).toFixed(1) : "0";
                return (
                  <tr key={item.stage} className="border-b border-slate-50 last:border-0">
                    <td className="px-3 py-3">
                      <span className="flex items-center gap-2 font-semibold text-slate-700">
                        <span className={`h-2.5 w-2.5 rounded-full ${STAGE_DOT[item.stage] || "bg-slate-400"}`} />
                        {item.label}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-lg font-bold text-slate-800">{item.count}</td>
                    <td className="px-3 py-3 text-slate-600">{formatRupiah(item.value)}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className={`h-full rounded-full bg-gradient-to-r transition-[width] duration-700 ${STAGE_GRADIENT[item.stage] || "from-slate-400 to-slate-500"}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-xs font-bold text-slate-600">{pct}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </ChartCard>
    </div>
  );
}
