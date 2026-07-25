import React from "react";
import { X, Users, Building2 } from "lucide-react";
import { SearchInput } from "@/components/ui/search-input.jsx";
import { Button } from "@/components/ui/button.jsx";
import { cn } from "@/lib/utils.js";
import { PIPELINE_STAGES, LEAD_SOURCES } from "@/utils/format.js";

// Tab tipe pelanggan + quick chip + toolbar filter. Diekstrak dari
// pages/Customers.jsx (Wave 5B) supaya halaman induk jadi orkestrator saja.
// SEMUA state tetap dipegang induk — komponen ini murni presentasional
// (controlled), jadi tidak ada sumber kebenaran kedua.

const SELECT_CLS =
  "h-8 rounded-lg border border-slate-200 bg-white px-2 text-[13px] text-slate-600 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40";

// Quick chip: warna aktif berbeda per chip supaya cepat dikenali (VIP ungu,
// belum order oranye, tidak aktif abu) — dipertahankan dari versi CSS lama.
const CHIPS = [
  { key: "vip",      label: "VIP (≥ Rp5jt)",        active: "bg-chart-violet text-white border-chart-violet" },
  { key: "no-order", label: "Belum Order",           active: "bg-chart-orange text-white border-chart-orange" },
  { key: "inactive", label: "Tidak Aktif (>30 hari)", active: "bg-slate-500 text-white border-slate-500" },
];

export default function CustomerFilters({
  typeTab, onTypeTab, counts,
  quickChip, onQuickChip,
  search, onSearch,
  filterStage, onFilterStage,
  filterSource, onFilterSource,
  filterCity, onFilterCity,
  filterSales, onFilterSales,
  cities, salesUsers,
  hasFilters, onReset,
}) {
  const tabs = [
    { key: "all",      label: "Semua",    Icon: Users,      count: counts.all },
    { key: "end-user", label: "End User", Icon: Users,      count: counts.endUser },
    { key: "korporat", label: "Korporat", Icon: Building2,  count: counts.korporat },
  ];

  return (
    <div className="flex flex-col gap-3">
      {/* Tab tipe pelanggan */}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-slate-100 pb-px">
        {tabs.map(({ key, label, Icon, count }) => {
          const on = typeTab === key;
          return (
            <button
              key={key}
              onClick={() => onTypeTab(key)}
              aria-current={on ? "true" : undefined}
              className={cn(
                "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-semibold transition-colors duration-150",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40",
                on
                  ? "border-brand-600 text-brand-700"
                  : "border-transparent text-slate-400 hover:text-slate-600"
              )}
            >
              <Icon size={14} />
              {label}
              <span className={cn(
                "rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
                on ? "bg-brand-50 text-brand-700" : "bg-slate-100 text-slate-500"
              )}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Quick chips */}
      <div className="flex flex-wrap gap-1.5">
        {CHIPS.map(({ key, label, active }) => (
          <button
            key={key}
            onClick={() => onQuickChip(quickChip === key ? "" : key)}
            aria-pressed={quickChip === key}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-semibold transition-colors duration-150",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40",
              quickChip === key ? active : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Search + filter */}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <SearchInput
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Cari nama, nomor, email, atau Instagram…"
          className="lg:max-w-xs"
        />

        <div className="flex flex-wrap items-center gap-1.5">
          <select className={SELECT_CLS} value={filterStage} onChange={(e) => onFilterStage(e.target.value)} aria-label="Filter stage">
            <option value="">Semua Stage</option>
            {PIPELINE_STAGES.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
          </select>

          <select className={SELECT_CLS} value={filterSource} onChange={(e) => onFilterSource(e.target.value)} aria-label="Filter sumber lead">
            <option value="">Semua Sumber</option>
            {LEAD_SOURCES.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
          </select>

          <select className={SELECT_CLS} value={filterCity} onChange={(e) => onFilterCity(e.target.value)} aria-label="Filter kota">
            <option value="">Semua Kota</option>
            {cities.map((city) => <option key={city} value={city}>{city}</option>)}
          </select>

          <select className={SELECT_CLS} value={filterSales} onChange={(e) => onFilterSales(e.target.value)} aria-label="Filter sales person">
            <option value="">Semua Sales Person</option>
            {salesUsers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>

          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={onReset}>
              <X size={14} /> Reset
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
