import React from "react";

// Tooltip custom dipakai semua chart recharts di Laporan — rounded, shadow,
// nilai sudah diformat oleh caller (formatter prop), bukan angka mentah.
export default function ChartTooltip({ active, payload, label, formatter, labelFormatter }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-slate-100 bg-white/95 px-3.5 py-2.5 shadow-lg shadow-slate-900/10 backdrop-blur-sm">
      {label != null && (
        <p className="mb-1 text-[11px] font-semibold text-slate-400">
          {labelFormatter ? labelFormatter(label) : label}
        </p>
      )}
      <div className="flex flex-col gap-0.5">
        {payload.map((entry, i) => {
          const [val, name] = formatter ? formatter(entry.value, entry.name, entry) : [entry.value, entry.name];
          return (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="h-2 w-2 rounded-full" style={{ background: entry.color || entry.fill }} />
              <span className="text-slate-500">{name}</span>
              <span className="ml-auto font-semibold text-slate-700">{val}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
