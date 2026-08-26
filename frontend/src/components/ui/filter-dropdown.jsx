import React from "react";
import { ChevronDown, Check } from "lucide-react";
import { Menu, MenuItem } from "./menu.jsx";
import { cn } from "@/lib/utils.js";

// ─── FILTER DROPDOWN (Sano DS v2) ────────────────────────────────────────────
// Menggantikan pola lama "native <select> + appearance:none" yang dipakai di
// filter bar Order/Pelanggan/Pipeline/Laporan.
//
// KENAPA DIGANTI TOTAL, BUKAN DITAMBAL LAGI: `appearance:none` (tokens.css,
// wajib supaya <select> ikut gaya design system) membuang jaminan BAWAAN
// browser bahwa kotak select otomatis melebar mengikuti opsi TERPANJANG
// (bukan cuma yang sedang terpilih). Ini sudah menyebabkan bug yang SAMA
// muncul berkali-kali di halaman berbeda (Order, Pelanggan, Pipeline,
// Laporan) — tiap kali ditambal dengan `min-w-[...]` manual per pemanggil,
// bug yang SAMA muncul lagi di select BERIKUTNYA yang lupa dikasih. Native
// <select> juga TIDAK PUNYA cara resmi diberi `overflow` yang benar — kalau
// box-nya kebetulan lebih sempit dari isinya (mis. gara-gara flex-shrink di
// header sempit), sebagian browser membiarkan teksnya BOCOR keluar kotak
// alih-alih di-clip, bukan cuma "terpotong tanpa jejak" seperti yang selama
// ini didiagnosis — kadang malah tumpang-tindih elemen tetangga.
//
// FilterDropdown menghindari SELURUH kelas bug itu: trigger-nya tombol biasa
// (lebar otomatis mengikuti isi, seperti elemen HTML lain, tidak ada mode
// "appearance" istimewa), dan menu pilihannya di-render lewat Portal Radix
// (components/ui/menu.jsx, sudah dipakai menu profil/aksi lain) — otomatis
// lolos dari batas overflow/stacking context kartu manapun ia berada
// (pelajaran yang sama seperti tooltip heatmap Traffic yang butuh Portal
// karena `animate-fade-rise` bikin ChartCard jadi containing block).
//
// API SENGAJA sedekat mungkin dengan <select> biasa (value/onChange/options)
// supaya migrasi dari <select> lama tinggal ganti tag, bukan menulis ulang
// state management di tiap pemanggil.
export function FilterDropdown({
  value,
  onChange,
  options,           // [{ value, label }]
  placeholder,       // teks saat value === ""
  icon: Icon,
  activeColor = "var(--accent)",
  className,
  triggerClassName,
  ariaLabel,
  align = "start",
  disabled = false,
  title,
}) {
  const active = value !== "" && value != null;
  const current = options.find((o) => o.value === value);
  const label = current ? current.label : placeholder;

  return (
    <Menu
      align={align}
      trigger={
        <button
          type="button"
          disabled={disabled}
          aria-label={ariaLabel}
          title={title}
          className={cn(
            "flex h-8 max-w-[220px] items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors duration-150",
            "border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
            disabled ? "cursor-not-allowed opacity-60" : undefined,
            active
              ? "border-accent/40 bg-accentbg text-accent"
              : "border-line bg-surface text-ink2 hover:border-accent/30",
            triggerClassName,
          )}
        >
          {Icon && (
            <Icon
              size={13}
              className="shrink-0"
              style={{ color: active ? activeColor : "var(--text-tertiary)" }}
            />
          )}
          <span className="min-w-0 flex-1 truncate text-left">{label}</span>
          <ChevronDown size={13} className="shrink-0 opacity-60" />
        </button>
      }
      className={cn("max-h-[320px] max-w-[280px] overflow-y-auto", className)}
    >
      <FilterDropdownRow selected={!active} onSelect={() => onChange("")}>
        {placeholder}
      </FilterDropdownRow>
      {options.map((o) => (
        <FilterDropdownRow key={o.value} selected={value === o.value} onSelect={() => onChange(o.value)}>
          {o.label}
        </FilterDropdownRow>
      ))}
    </Menu>
  );
}

// Checkmark SELALU dirender (opacity 0 kalau bukan baris terpilih) — bukan
// render kondisional — supaya indentasi teks semua baris tetap sejajar,
// tidak "loncat" tergantung ada/tidaknya centang.
function FilterDropdownRow({ selected, onSelect, children }) {
  return (
    <MenuItem onSelect={onSelect}>
      <Check size={14} className={cn("shrink-0", selected ? "text-accent" : "opacity-0")} />
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </MenuItem>
  );
}
