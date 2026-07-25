import React, { useState } from "react";
import { getDatePreset } from "../utils/format.js";
import { cn } from "../lib/utils.js";

const PRESETS = [
  { key: "today", label: "Hari Ini" },
  { key: "7d",    label: "7 Hari" },
  { key: "30d",   label: "30 Hari" },
  { key: "3m",    label: "3 Bulan" },
];

// Props: value: {from, to}, onChange: ({from, to}) => void
//
// Wave 5A: reskin ke Tailwind (dari .date-range-picker/.drp-* di index.css).
// Perilaku TIDAK berubah. Preset tetap menghasilkan tanggal kalender WIB —
// lihat getDatePreset() di utils/format.js; itu kontrak dengan backend
// (buildDateWhere menafsirkan ?from/?to sebagai tanggal WIB).
export default function DateRangePicker({ value, onChange }) {
  const [customMode, setCustomMode] = useState(false);

  function handlePreset(key) {
    setCustomMode(false);
    onChange(getDatePreset(key));
  }

  function handleCustom() {
    setCustomMode(true);
    onChange({ from: "", to: "" });
  }

  function isActive(key) {
    if (customMode) return false;
    const preset = getDatePreset(key);
    return preset.from === value?.from && preset.to === value?.to;
  }

  // Segmented control: satu grup rapat dengan border tunggal, item aktif
  // terangkat putih (pola yang sama dengan TabsList di ui/tabs.jsx).
  const item = "h-7 rounded-md px-2.5 text-xs font-semibold transition-colors duration-150 " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40";
  const itemActive = "bg-white text-brand-700 shadow-sm";
  const itemIdle   = "text-slate-500 hover:text-slate-700";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5">
        {PRESETS.map(({ key, label }) => (
          <button
            key={key}
            className={cn(item, isActive(key) ? itemActive : itemIdle)}
            onClick={() => handlePreset(key)}
            aria-pressed={isActive(key)}
          >
            {label}
          </button>
        ))}
        <button
          className={cn(item, customMode ? itemActive : itemIdle)}
          onClick={handleCustom}
          aria-pressed={customMode}
        >
          Custom
        </button>
      </div>

      {customMode && (
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
            value={value?.from || ""}
            onChange={(e) => onChange({ ...value, from: e.target.value })}
            aria-label="Tanggal mulai"
          />
          <span className="text-xs text-slate-400">–</span>
          <input
            type="date"
            className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
            value={value?.to || ""}
            onChange={(e) => onChange({ ...value, to: e.target.value })}
            aria-label="Tanggal akhir"
          />
        </div>
      )}
    </div>
  );
}
