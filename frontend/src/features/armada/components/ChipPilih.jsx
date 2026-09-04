import React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils.js";
import Avatar from "@/components/Avatar.jsx";

// Chip-avatar 1-tap (D-036, 30 Agustus 2026) — gantikan <select> polos untuk
// pilih driver/kendaraan. Armada Sano masih kecil (3 driver aktif per
// CLAUDE.md §1), jadi "pilih dari beberapa chip" lebih cepat diketuk
// daripada buka dropdown native, terutama di layar sentuh. Dipakai
// JobDetailDrawer.jsx DAN ArmadaDashboard.jsx (panel "Perlu Dijadwalkan")
// — satu komponen, supaya pola assign-nya identik di dua tempat.
//
// Chip aktif SOLID accent + teks putih (D-047, 4 September 2026 — "buat
// seperti artifacts", showcase #3) — sebelumnya tint pucat + teks gelap,
// terasa lemah dibanding chip status lain yang sudah solid/tegas di
// halaman ini. Border sedikit lebih tebal (2px) supaya kelihatan
// "dipilih", bukan cuma warna beda tipis.
export default function ChipPilih({ items, selectedId, disabled, onPick, kosongLabel, size = "default" }) {
  const h = size === "sm" ? "h-7 text-[11px]" : "h-9 text-[12px]";
  return (
    <div className="flex flex-wrap gap-1.5">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onPick(null)}
        className={cn(
          "flex items-center gap-1.5 rounded-full border-2 px-2.5 font-medium transition-colors disabled:opacity-50", h,
          !selectedId ? "border-ink3 bg-inset text-ink2" : "border-border text-ink3 hover:border-ink3"
        )}
      >
        {kosongLabel}
      </button>
      {items.map((it) => {
        const active = selectedId === it.id;
        return (
          <button
            key={it.id}
            type="button"
            disabled={disabled}
            onClick={() => onPick(it.id)}
            className={cn(
              "flex items-center gap-1.5 rounded-full border-2 pl-1 pr-2.5 font-semibold transition-colors disabled:opacity-50", h,
              active ? "border-accent bg-accent text-white shadow-card" : "border-border text-ink2 hover:border-ink3"
            )}
          >
            <Avatar name={it.name} size="sm" className={size === "sm" ? "h-5 w-5 text-[9px]" : "h-6 w-6 text-[10px]"} />
            {it.name}
            {active && <Check size={size === "sm" ? 11 : 13} className="text-white" />}
          </button>
        );
      })}
    </div>
  );
}
