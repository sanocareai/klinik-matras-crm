import React from "react";
import { Columns3, Check } from "lucide-react";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "@/components/ui/menu.jsx";
import { cn } from "@/lib/utils.js";
import { KOLOM_TAMBAHAN } from "@/features/customers/columns.js";

// Menu "Kolom" — menyalakan kolom tambahan tabel Pelanggan. Memakai Menu/MenuItem yang sudah ada (Radix); tidak ada
// komponen pilih-kolom lain di codebase untuk dipakai ulang. Tabel hanya muncul di ≥768px, jadi menu ini juga
// disembunyikan di bawahnya (`hidden md:inline-flex`) — di HP daftar berbentuk kartu.
// Menu TIDAK menutup tiap kali satu kolom diklik (preventDefault pada onSelect) supaya beberapa kolom bisa dinyalakan sekaligus.
export default function KolomMenu({ aktif, onToggle, onReset }) {
  const jumlah = aktif.length;
  return (
    <Menu
      align="end"
      trigger={
        <button
          type="button"
          aria-label="Atur kolom tabel"
          title="Tampilkan kolom tambahan di tabel"
          className={cn(
            "crm-pel-kolom hidden h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] font-medium transition-colors duration-150 md:inline-flex",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
            jumlah > 0 ? "border-accent/40 bg-accentbg text-accent" : "border-line bg-surface text-ink2 hover:border-accent/30"
          )}
        >
          <Columns3 size={14} className="shrink-0" />
          Kolom{jumlah > 0 ? ` +${jumlah}` : ""}
        </button>
      }
    >
      <MenuLabel>Kolom tambahan</MenuLabel>
      {KOLOM_TAMBAHAN.map(({ key, label }) => {
        const on = aktif.includes(key);
        return (
          <MenuItem key={key} onSelect={(e) => { e.preventDefault(); onToggle(key); }} role="menuitemcheckbox" aria-checked={on}>
            <Check size={14} className={cn("shrink-0", on ? "text-accent" : "opacity-0")} />
            <span className="min-w-0 flex-1 truncate">{label}</span>
          </MenuItem>
        );
      })}
      <MenuSeparator />
      <MenuItem onSelect={(e) => { e.preventDefault(); onReset(); }} disabled={jumlah === 0}>
        <span className="flex-1">Kembali ke tampilan standar</span>
      </MenuItem>
    </Menu>
  );
}
