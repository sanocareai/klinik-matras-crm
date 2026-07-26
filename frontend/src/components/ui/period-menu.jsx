import React from "react";
import { ChevronDown, Check } from "lucide-react";
import { Menu, MenuItem } from "./menu.jsx";
import { cn } from "@/lib/utils.js";

// ─── PERIOD MENU (DS v2.2) ────────────────────────────────────────────────────
// Dropdown pemilih periode DI DALAM kartu (Deal Pipeline, Top Performing Reps).
// Sebelumnya slot ini diisi FilterPill statis — tulisan pil ("30 hari terakhir")
// TANPA onClick, jadi terlihat seperti kontrol tapi tidak melakukan apa pun.
// Ini versi FUNGSIONAL: dropdown asli (Radix, via Menu primitive) yang benar-
// benar mengganti rentang tanggal dan memicu refetch di pemanggilnya.
//
// Trigger sengaja bertint BIRU (bukan netral seperti FilterPill) — ini kontrol
// yang MENGUBAH data yang sedang dilihat, beda dari label read-only.
const PILIHAN_DEFAULT = [
  { id: "last_7_days",   label: "7 hari terakhir" },
  { id: "last_30_days",  label: "30 hari terakhir" },
  { id: "last_3_months", label: "3 bulan terakhir" },
  { id: "all_time",      label: "Semua waktu" },
];

export default function PeriodMenu({ value, onChange, options = PILIHAN_DEFAULT, className }) {
  const aktif = options.find((o) => o.id === value) || options[0];

  return (
    <Menu
      align="end"
      trigger={
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1.5",
            "text-[12px] font-semibold text-blue-700 transition-colors hover:bg-blue-100",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
            className
          )}
        >
          {aktif?.label}
          <ChevronDown size={13} strokeWidth={2.5} />
        </button>
      }
    >
      {options.map((o) => (
        <MenuItem key={o.id} onSelect={() => onChange(o.id)}>
          <span className="flex w-4 shrink-0 items-center justify-center">
            {o.id === value && <Check size={13} strokeWidth={3} className="text-accent" />}
          </span>
          {o.label}
        </MenuItem>
      ))}
    </Menu>
  );
}
