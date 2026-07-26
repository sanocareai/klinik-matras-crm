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

// Select filter: netral (belum dipilih apa-apa) vs aktif (accent — satu-
// satunya warna dekoratif di design system ini, lihat styles/tailwind.css
// "SATU-SATUNYA warna dekoratif"). Border ditambah supaya kotaknya
// kelihatan jelas batasnya di background gelap (sebelumnya bg-surface
// polos nyaris menyatu dengan latar, jadi terasa "datar"/kurang hidup).
function selectCls(active) {
  return cn(
    "h-8 rounded-lg px-2 text-[13px] font-medium transition-colors duration-150",
    "border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
    active
      ? "border-accent/40 bg-accentbg text-accent"
      : "border-line bg-surface text-ink2 hover:border-accent/30"
  );
}

// Quick chip: warna aktif berbeda per chip supaya cepat dikenali (VIP ungu,
// belum order oranye, tidak aktif abu) — dipertahankan dari versi CSS lama.
const CHIPS = [
  { key: "vip",      label: "VIP (≥ Rp5jt)",        active: "bg-accent text-white border-accent" },
  { key: "no-order", label: "Belum Order",           active: "bg-orange text-white border-orange" },
  { key: "inactive", label: "Tidak Aktif (>30 hari)", active: "bg-ink3 text-surface" },
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
      <div className="flex items-center gap-1 overflow-x-auto border-b border-line pb-px">
        {tabs.map(({ key, label, Icon, count }) => {
          const on = typeTab === key;
          return (
            <button
              key={key}
              onClick={() => onTypeTab(key)}
              aria-current={on ? "true" : undefined}
              className={cn(
                "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-semibold transition-colors duration-150",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
                on
                  ? "text-accent"
                  : "border-transparent text-ink3 hover:text-ink"
              )}
            >
              <Icon size={14} />
              {label}
              <span className={cn(
                "rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
                on ? "bg-accentbg text-accent" : "bg-inset text-ink2"
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
              "rounded-full  px-3 py-1 text-xs font-semibold transition-colors duration-150",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
              quickChip === key ? active : "bg-surface text-ink2 hover:text-ink"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Search + filter — flex-wrap (BUKAN nowrap seperti sebelumnya) supaya
          kalau tidak muat di 1 baris, dropdown filter turun ke baris baru,
          bukan memaksa search box menyusut sampai placeholder-nya kepotong.
          min-w di search memastikan lebar minimum yang tetap nyaman dibaca. */}
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Cari nama, nomor, email, atau Instagram…"
          className="w-full min-w-[240px] flex-1 sm:w-auto sm:flex-none sm:basis-72"
        />

        <div className="flex flex-wrap items-center gap-1.5">
          <select className={selectCls(!!filterStage)} value={filterStage} onChange={(e) => onFilterStage(e.target.value)} aria-label="Filter stage">
            <option value="">Semua Stage</option>
            {PIPELINE_STAGES.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
          </select>

          <select className={selectCls(!!filterSource)} value={filterSource} onChange={(e) => onFilterSource(e.target.value)} aria-label="Filter sumber lead">
            <option value="">Semua Sumber</option>
            {LEAD_SOURCES.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
          </select>

          <select className={selectCls(!!filterCity)} value={filterCity} onChange={(e) => onFilterCity(e.target.value)} aria-label="Filter kota">
            <option value="">Semua Kota</option>
            {cities.map((city) => <option key={city} value={city}>{city}</option>)}
          </select>

          <select className={selectCls(!!filterSales)} value={filterSales} onChange={(e) => onFilterSales(e.target.value)} aria-label="Filter sales person">
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
