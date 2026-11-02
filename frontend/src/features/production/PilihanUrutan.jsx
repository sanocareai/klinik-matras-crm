import React from "react";
import { ArrowDownUp, Check, ChevronDown } from "lucide-react";
import { Menu, MenuItem } from "@/components/ui/menu.jsx";
import { URUTAN_DAFTAR } from "@/features/production/orderProduksiModel.js";

// Urutan daftar Order Produksi: pilihan TUNGGAL tanpa baris "kosong" (FilterDropdown selalu menambah baris placeholder di atas opsi, sehingga "Terbaru dulu" muncul dua kali).
// Setiap pilihan hanya muncul sekali; definisi urutan sama dengan server (terbaru = order masuk terbaru dulu, terlama = order masuk paling lama dulu).
export default function PilihanUrutan({ value, onChange, ringkas = false }) {
  const aktif = URUTAN_DAFTAR.find((u) => u.key === value) ?? URUTAN_DAFTAR[0];
  return (
    <Menu
      align="start"
      trigger={
        <button type="button" className={"prod-filter-pemicu prod-ol-urut-pemicu" + (ringkas ? " ringkas" : "")} title={`Urutan: ${aktif.label}`} aria-label={`Urutan daftar: ${aktif.label}`} data-testid="urutan-pemicu">
          <ArrowDownUp size={16} aria-hidden className="shrink-0" />
          {!ringkas && <span className="min-w-0 flex-1 truncate text-left">{aktif.label}</span>}
          {!ringkas && <ChevronDown size={16} aria-hidden className="shrink-0 opacity-60" />}
        </button>
      }
    >
      {URUTAN_DAFTAR.map((u) => (
        <MenuItem key={u.key} onSelect={() => onChange(u.key)} data-testid={`urutan-${u.key}`}>
          <Check size={14} aria-hidden className={u.key === aktif.key ? "shrink-0 text-accent" : "shrink-0 opacity-0"} />
          <span className="min-w-0 flex-1">{u.label}</span>
        </MenuItem>
      ))}
    </Menu>
  );
}
