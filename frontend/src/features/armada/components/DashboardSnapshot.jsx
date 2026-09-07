import React from "react";
import { cn } from "@/lib/utils.js";

// "Today's Operational Snapshot" — redesain Dashboard Control Tower (7
// September 2026, brief owner: jawab kondisi operasional hari ini dalam <5
// detik). MENGGANTIKAN grid 6-kartu rata DeliveryKpiRow KHUSUS di halaman ini
// (DeliveryKpiRow.jsx sendiri TIDAK disentuh — masih dipakai/reusable di
// tempat lain kalau perlu, ini kartu terpisah).
//
// Bentuknya SENGAJA 1 kartu besar (antrean belum terjadwal — pekerjaan
// dispatcher yang paling mendesak) + 4 kartu kecil pendamping, BUKAN 5 kartu
// rata seperti sebelumnya — supaya mata langsung berhenti di angka yang
// paling penting dulu, baru menyapu 4 lainnya sebagai konteks.
//
// TIDAK ADA angka yang dikarang di sini — semua props adalah hitungan
// langsung dari data yang sudah di-fetch parent (ArmadaDashboard.jsx),
// komponen ini murni presentasi + layout.
const TONE = {
  neutral: { badge: "bg-inset text-ink3" },
  accent:  { badge: "bg-accentbg text-accent" },
  green:   { badge: "bg-greenbg text-green" },
  orange:  { badge: "bg-orangebg text-orange" },
  red:     { badge: "bg-redbg text-red" },
};

function SecondaryCard({ item }) {
  const tone = TONE[item.tone] || TONE.neutral;
  return (
    <button
      type="button"
      onClick={item.onClick}
      disabled={!item.onClick}
      className={cn(
        "flex flex-col gap-2 rounded-card border border-border bg-surface p-3.5 text-left transition-all",
        item.onClick && "hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-card",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default"
      )}
    >
      {item.icon && (
        <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", tone.badge)}>
          <item.icon size={14} strokeWidth={2} aria-hidden />
        </span>
      )}
      <span>
        <strong className="dh-figure block text-[22px] font-extrabold leading-none tracking-tight text-ink">
          {item.value}
        </strong>
        <span className="mt-1 block text-[11px] font-semibold leading-snug text-ink2">{item.label}</span>
        {item.sub && <span className="mt-0.5 block text-[10.5px] leading-snug text-ink3">{item.sub}</span>}
      </span>
    </button>
  );
}

export default function DashboardSnapshot({ primary, secondary }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {/* Kartu utama — border aksen (pola yang sama dengan kartu "Perlu
          Dijadwalkan" di bawah), col-span-2 di layar lebar supaya benar-benar
          menonjol dari 4 kartu pendamping, bukan cuma kartu ke-1 dari 5. */}
      <button
        type="button"
        onClick={primary.onClick}
        className="col-span-2 flex flex-col justify-between gap-3 rounded-card border-2 border-accent/30 bg-surface p-4 text-left transition-all hover:-translate-y-0.5 hover:border-accent/60 hover:shadow-card focus:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:col-span-3 lg:col-span-2"
      >
        <div className="flex items-center gap-2">
          {primary.icon && (
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accentbg text-accent">
              <primary.icon size={16} strokeWidth={2} aria-hidden />
            </span>
          )}
          <span className="text-[12.5px] font-bold text-ink">{primary.label}</span>
        </div>
        <div>
          <strong className="dh-figure block text-[36px] font-extrabold leading-none tracking-tight text-ink">
            {primary.value}
          </strong>
          {primary.sub && <span className="mt-1.5 block text-[11.5px] text-ink3">{primary.sub}</span>}
        </div>
      </button>

      {secondary.map((item) => <SecondaryCard key={item.key} item={item} />)}
    </div>
  );
}
