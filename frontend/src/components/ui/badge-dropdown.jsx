import React from "react";
import { ChevronDown, Check, Lock } from "lucide-react";
import { Menu, MenuItem } from "./menu.jsx";
import { cn } from "@/lib/utils.js";

// ─── BADGE DROPDOWN (Sano DS v2) ──────────────────────────────────────────────
// Sepupu `FilterDropdown` (components/ui/filter-dropdown.jsx) — API mirip,
// tapi trigger-nya sendiri BERWARNA sesuai nilai yang sedang aktif (bukan
// tombol netral yang cuma berubah warna saat "aktif") — ini yang dipakai
// untuk pilihan status/tahap/pembayaran per-baris (Order/Pipeline/Pelanggan)
// yang SEBELUMNYA berupa native <select appearance:none> distyle jadi chip
// warna. Alasan diganti SAMA dengan FilterDropdown: <select> appearance:none
// tidak dijamin browser melebar mengikuti opsi terpanjang, dan sebagian
// browser membiarkan teks bocor keluar kotak alih-alih clip kalau kotaknya
// kesempitan (lihat catatan panjang di filter-dropdown.jsx).
//
// `getChipClass(value)` — fungsi, BUKAN objek — supaya pemanggil bisa pakai
// tone map lokal APA PUN yang sudah ada (STATUS_TONE, PAYMENT_TONE,
// `badgeVariants({variant: stageVariant(v)})`, dst) tanpa BadgeDropdown perlu
// tahu skema warna spesifik tiap pemanggil.
//
// ⚠️ `badgeVariants()` (salah satu isi getChipClass yang umum dipakai) IKUT
// membawa ukurannya sendiri (px-2 py-1 text-[11px]), bukan cuma warna — kalau
// hasilnya taruh PALING AKHIR di `cn()`, twMerge akan membiarkan ukuran ITU
// menang, bikin chip PipelineStageSelect lebih besar dari StatusSelect/
// PaymentStatusSelect (yang tone map-nya cuma "bg-x text-y", tanpa ukuran) —
// inkonsistensi visual yang SEBELUMNYA memang sengaja dicegah di kode lama
// (lihat commit sebelum refactor ini). LAYOUT_CLS sengaja diulang PALING
// TERAKHIR di kedua tempat pakai `cn()` di bawah supaya ukuran/rounded selalu
// punya BadgeDropdown menang, apa pun isi getChipClass — bukan duplikasi
// ceroboh, ini yang menjamin ke-3 chip selalu SAMA BESAR.
const TRIGGER_LAYOUT = "inline-flex max-w-full items-center gap-1 rounded-chip border-0 py-0.5 pl-2 pr-1.5 text-[10px] font-semibold uppercase tracking-wide";
const ROW_LAYOUT = "inline-flex items-center rounded-chip px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide";

export function BadgeDropdown({
  value,
  onChange,          // (newValue) => void — pemanggil yang urus bentuk payload-nya sendiri
  options,           // [{ value, label }]
  getChipClass,      // (value) => className string (bg + text warna) — opsional
  getChipStyle,      // (value) => {background, color} — opsional, utk pemanggil yang
                      // BELUM pindah ke Tailwind (mis. OrderSection.jsx, masih pakai
                      // inline style {bg,color} hex). Boleh dipakai BARENG getChipClass
                      // (className utk layout, style utk warna) atau sendiri-sendiri.
  disabled = false,
  locked = false,    // tampilkan ikon gembok TANPA menonaktifkan (mis. override manual)
  lockedTitle,
  title,             // tooltip default (dipakai kalau TIDAK locked)
  ariaLabel,
  triggerClassName,
  align = "start",
}) {
  const current = options.find((o) => o.value === value);
  const label = current ? current.label : value;

  return (
    <Menu
      align={align}
      trigger={
        <button
          type="button"
          disabled={disabled}
          aria-label={ariaLabel}
          title={locked ? lockedTitle : title}
          onClick={(e) => e.stopPropagation()}
          style={getChipStyle ? getChipStyle(value) : undefined}
          className={cn(
            TRIGGER_LAYOUT,
            "border-0 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
            disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:opacity-85",
            getChipClass?.(value),
            TRIGGER_LAYOUT,
            triggerClassName,
          )}
        >
          {locked && <Lock size={9} className="shrink-0" />}
          <span className="min-w-0 flex-1 truncate text-left">{label}</span>
          <ChevronDown size={10} className="shrink-0 opacity-70" />
        </button>
      }
    >
      {options.map((o) => (
        <MenuItem
          key={o.value}
          onSelect={() => onChange(o.value)}
          className="justify-between gap-3"
        >
          <span
            style={getChipStyle ? getChipStyle(o.value) : undefined}
            className={cn(ROW_LAYOUT, getChipClass?.(o.value), ROW_LAYOUT)}
          >
            {o.label}
          </span>
          {value === o.value && <Check size={14} className="shrink-0 text-accent" />}
        </MenuItem>
      ))}
    </Menu>
  );
}
