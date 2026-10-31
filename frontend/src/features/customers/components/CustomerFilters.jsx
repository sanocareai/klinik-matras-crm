import React from "react";
import { X, Users, Building2, GitBranch, Tag, MapPin, UserRound } from "lucide-react";
import { SearchInput } from "@/components/ui/search-input.jsx";
import { Button } from "@/components/ui/button.jsx";
import { FilterDropdown } from "@/components/ui/filter-dropdown.jsx";
import { cn } from "@/lib/utils.js";
import { PIPELINE_STAGES, LEAD_SOURCES } from "@/utils/format.js";

// Toolbar Pelanggan (Fase 2, 31 Okt 2026): SATU blok ringkas —
//   baris 1: tab tipe (Semua / End User / Korporat) + filter cepat
//   baris 2: pencarian daftar + filter lanjutan (Stage, Sumber, Kota, Sales) + Reset + slot kanan (menu Kolom)
// Diekstrak dari pages/Customers.jsx (Wave 5B) supaya halaman induk jadi orkestrator saja. SEMUA state tetap
// dipegang induk — komponen ini murni presentasional (controlled), jadi tidak ada sumber kebenaran kedua.
// Tidak ada filter baru: dropdown, chip, tab, dan pencarian sama dengan sebelumnya, hanya disusun ulang.
//
// 4 dropdown filter memakai FilterDropdown (bukan native <select>) — bug "opsi kepotong" (appearance: none) sudah
// berulang di Order/Pelanggan/Pipeline/Laporan; lihat catatan panjang di filter-dropdown.jsx.

// Quick chip: warna aktif berbeda per chip supaya cepat dikenali (VIP ungu,
// belum order oranye, tidak aktif abu) — dipertahankan dari versi CSS lama.
const CHIPS = [
  { key: "vip",      label: "VIP (≥ Rp5jt)",        active: "bg-accent text-white border-accent" },
  { key: "no-order", label: "Belum Order",           active: "bg-orange text-white border-orange" },
  { key: "inactive", label: "Tidak Aktif (>30 hari)", active: "bg-ink3 text-surface" },
  // Kondisi Sakit (4 Sep 2026) — DIBACA dari Order.healthStatus (cocok
  // kalau ADA SATU ATAU LEBIH order pelanggan ini yang healthStatus-nya
  // SAKIT), BUKAN Customer.healthStatus lama (field itu tidak lagi diedit
  // lewat UI mana pun, lihat catatan panjang di
  // InfoSection.jsx/ProfileFields.jsx).
  { key: "sakit",    label: "Sakit",                 active: "bg-red text-white border-red" },
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
  trailing,
}) {
  const tabs = [
    { key: "all",      label: "Semua",    Icon: Users,      count: counts.all },
    { key: "end-user", label: "End User", Icon: Users,      count: counts.endUser },
    { key: "korporat", label: "Korporat", Icon: Building2,  count: counts.korporat },
  ];

  return (
    <div className="crm-pel-toolbar flex flex-col gap-3">
      <div className="crm-pel-bar1 flex flex-wrap items-center gap-x-4 gap-y-2">
        {/* Tab tipe pelanggan */}
        <div className="crm-pel-tabs flex items-center gap-1 overflow-x-auto border-b border-line pb-px">
          {tabs.map(({ key, label, Icon, count }) => {
            const on = typeTab === key;
            return (
              <button
                key={key}
                onClick={() => onTypeTab(key)}
                aria-current={on ? "true" : undefined}
                className={cn(
                  "crm-pel-tab -mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-semibold transition-colors duration-150",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
                  on
                    ? "text-accent"
                    : "border-transparent text-ink3 hover:text-ink"
                )}
              >
                <Icon size={14} />
                {label}
                <span className={cn(
                  "crm-pel-hitung rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
                  on ? "bg-accentbg text-accent" : "bg-inset text-ink2"
                )}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Filter cepat */}
        <div className="crm-pel-chips flex flex-wrap gap-1.5">
          {CHIPS.map(({ key, label, active }) => (
            <button
              key={key}
              onClick={() => onQuickChip(quickChip === key ? "" : key)}
              aria-pressed={quickChip === key}
              className={cn(
                "crm-pel-chip rounded-full  px-3 py-1 text-xs font-semibold transition-colors duration-150",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
                quickChip === key ? active : "bg-surface text-ink2 hover:text-ink"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Pencarian + filter lanjutan: satu baris yang membungkus rapi (pencarian mendapat sisa ruang, minimum 260px
          supaya placeholder tidak terpotong di tengah kata). */}
      <div className="crm-pel-bar2 flex flex-wrap items-center gap-2">
        <SearchInput
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          onClear={() => onSearch("")}
          placeholder="Cari nama, nomor, email, atau Instagram…"
          className="crm-pel-search min-w-[260px] flex-1"
        />

        <div className="crm-pel-filters flex flex-wrap items-center gap-1.5">
          <FilterDropdown
            icon={GitBranch} activeColor="#ea580c"
            value={filterStage} onChange={onFilterStage}
            options={PIPELINE_STAGES.map(({ value, label }) => ({ value, label }))}
            placeholder="Semua Stage"
            ariaLabel="Filter stage"
          />

          <FilterDropdown
            icon={Tag} activeColor="#7c3aed"
            value={filterSource} onChange={onFilterSource}
            options={LEAD_SOURCES.map(({ value, label }) => ({ value, label }))}
            placeholder="Semua Sumber"
            ariaLabel="Filter sumber lead"
          />

          <FilterDropdown
            icon={MapPin} activeColor="#16a34a"
            value={filterCity} onChange={onFilterCity}
            options={cities.map((city) => ({ value: city, label: city }))}
            placeholder="Semua Kota"
            ariaLabel="Filter kota"
          />

          <FilterDropdown
            icon={UserRound} activeColor="#2563eb"
            value={filterSales} onChange={onFilterSales}
            options={salesUsers.map((u) => ({ value: u.id, label: u.name }))}
            placeholder="Semua Sales Person"
            ariaLabel="Filter sales person"
          />

          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={onReset} className="crm-pel-reset">
              <X size={14} /> Reset
            </Button>
          )}

          {trailing}
        </div>
      </div>
    </div>
  );
}
