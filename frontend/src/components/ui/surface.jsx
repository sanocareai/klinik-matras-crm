// ─── PERMUKAAN MENGAPUNG (Sano DS v2) ────────────────────────────────────────
// SATU-SATUNYA tempat elevasi berat diizinkan: popover, modal, sheet, dropdown.
// Semua permukaan mengapung memakai konstanta yang SAMA dari sini, supaya tidak
// muncul lima variasi shadow/blur yang berbeda-beda.
//
// Translucent + backdrop blur: bg-surface/80 memberi kesan material Apple.
// bg-surface (bukan bg-base) supaya di dark mode panelnya #1C1C1E — LEBIH TERANG
// dari halaman (#000000). Kalau pakai bg-base, panel melebur dengan latar.
//
// Diekspor sebagai STRING kelas (bukan komponen) karena konsumennya beragam:
// Radix Dialog.Content, div popover manual di DateRangePicker, dsb.
export const POPOVER_SURFACE =
  "rounded-card bg-surface/80 shadow-popover backdrop-blur-[20px] " +
  "supports-[not(backdrop-filter:blur(0))]:bg-surface";

// Overlay di belakang modal. Tanpa blur berat supaya konten di belakang masih
// terbaca sebagai konteks (dan supaya tidak mahal di HP kelas bawah).
export const OVERLAY = "fixed inset-0 bg-black/30";

// Item di dalam menu/popover. Radius lebih kecil dari panelnya (r-sm < r-lg).
export const POPOVER_ITEM =
  "flex w-full items-center gap-2 rounded-chip px-3 py-2 text-left text-[13px] " +
  "text-ink transition-colors hover:bg-hovertint";
