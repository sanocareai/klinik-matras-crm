// Logika MURNI untuk lebar layar tabel Finance (D-193, 22 Sep 2026) — TANPA React, TANPA alias `@/` — supaya bisa
// dites langsung dengan `node --test` (lihat tests/tableLayout.test.js), sama seperti features/finance/ringkasanKualitas.js.
// Dipakai oleh components/ui/table.jsx (TH/TD prop `hideBelow`).

// ⚠️ KENAPA CLASS DI SINI HARUS STRING LITERAL LENGKAP, BUKAN TEMPLATE STRING
// TERINTERPOLASI (`` `min-[${px}px]:table-cell` ``). Tailwind v4 (`@tailwindcss/
// vite`) menemukan class dengan MEMINDAI TEKS SUMBER secara statis (regex atas
// isi file), BUKAN menjalankan kode JS-nya. Kalau nama class dirakit dari
// variabel saat runtime, string lengkapnya ("hidden min-[1366px]:table-cell")
// TIDAK PERNAH muncul apa adanya di file sumber manapun — Tailwind tidak akan
// pernah men-generate aturan CSS-nya, dan `hidden` (base utility, SELALU ada
// karena dipakai di tempat lain) akan menyembunyikan kolom itu SELAMANYA di
// semua lebar layar, termasuk desktop penuh (persis bug yang task ini perbaiki,
// bukan cuma dipindah). Karena itu breakpoint yang didukung WAJIB ditulis
// sebagai literal lengkap di `HIDE_BELOW_CLASS` di bawah — menambah breakpoint
// baru = menambah satu baris literal baru, bukan mengubah pola interpolasi.
const HIDE_BELOW_CLASS = Object.freeze({
  640: "hidden min-[640px]:table-cell",
  768: "hidden min-[768px]:table-cell",
  1024: "hidden min-[1024px]:table-cell",
  1280: "hidden min-[1280px]:table-cell",
  1366: "hidden min-[1366px]:table-cell",
  1536: "hidden min-[1536px]:table-cell",
  1600: "hidden min-[1600px]:table-cell",
});

// Nama breakpoint → px. "tablet"/"wide" dipetakan presisi ke lebar yang diminta desain (kolom sekunder BOLEH
// sembunyi di 1024–1365, WAJIB terlihat mulai 1366) — bukan dipaksa ke breakpoint bawaan Tailwind yang terdekat
// tapi tidak pas (lg=1024 terlalu awal, xl=1280 masih di tengah 1024–1365).
// "uw" (ultra-wide, 1600) — D-XXX (perbaikan lanjutan 22 Sep 2026): kolom detail (Kategori/Divisi/Mode/Sumber
// Dana, dst) yang SEBELUMNYA muncul dari "wide" (1366) TERBUKTI membuat tombol aksi & kolom lain bertumpuk di
// 1366–1599 begitu Aksi/Bukti diberi ruang yang cukup untuk tidak overlap — didorong ke 1600 supaya kolom detail
// hanya muncul saat benar-benar ada ruang, bukan dipaksa muat.
export const HIDE_BELOW_BREAKPOINTS = Object.freeze({ sm: 640, md: 768, lg: 1024, tablet: 1024, xl: 1280, wide: 1366, "2xl": 1536, uw: 1600 });

// Kolom GABUNGAN (mis. "Klasifikasi" = Kategori+Divisi, "Pembayaran" = Mode+Sumber Dana) yang HANYA muncul di
// rentang 1280–1599px — di bawahnya (<1280) disembunyikan total (isinya pindah ke baris detail yang bisa dibuka,
// lihat DetailRow di table.jsx), di atasnya (>=1600) kolom aslinya yang terpisah yang tampil (hideBelow="uw"),
// bukan versi gabungan ini. SATU literal statis (bukan hasil interpolasi px min/max) — alasan sama seperti
// HIDE_BELOW_CLASS di atas.
const MID_ONLY_CLASS = "hidden min-[1280px]:table-cell min-[1600px]:hidden";

/** Kelas kolom gabungan yang HANYA tampil di 1280–1599px (lihat MID_ONLY_CLASS). */
export function midOnlyClass() {
  return MID_ONLY_CLASS;
}

// Tombol/ikon pembuka baris detail (expand) — HANYA relevan di 768–1279px, saat kolom sekunder disembunyikan
// dari tabel. Tabel itu sendiri sudah tidak dirender sama sekali di bawah 768px (lihat TABLE_VIEW_CLASS/
// CARD_VIEW_CLASS — dipakai Card List sebagai gantinya), jadi cukup disembunyikan dari 1280px ke atas.
// "md"/"1280" pakai token Tailwind bawaan (bukan arbitrary value) — 768 & 1280 kebetulan cocok breakpoint bawaan.
export const EXPAND_TOGGLE_HIDE_CLASS = "min-[1280px]:hidden";

/** Wrapper <table> — dirender penuh mulai 768px ke atas; di bawahnya diganti Card List (md = breakpoint bawaan Tailwind, persis 768px). */
export const TABLE_VIEW_CLASS = "hidden md:block";
/** Wrapper Card List — HANYA di bawah 768px; berbalikan dari TABLE_VIEW_CLASS. */
export const CARD_VIEW_CLASS = "md:hidden";

/**
 * `hideBelow` → nama class Tailwind (lookup literal, lihat catatan di atas — TIDAK menginterpolasi angka ke
 * string class). Terima preset bernama (lihat HIDE_BELOW_BREAKPOINTS) atau salah satu px yang terdaftar di
 * HIDE_BELOW_CLASS. Nilai lain (px sembarang yang tidak terdaftar, typo, dll) SENGAJA fallback ke "" (kolom
 * selalu tampil) — lebih aman salah "menampilkan kolom sekunder di layar sedang" daripada
 * "menyembunyikan kolom selamanya di semua lebar layar" akibat class yang tidak pernah di-generate Tailwind.
 */
export function hideBelowClass(hideBelow) {
  if (!hideBelow && hideBelow !== 0) return "";
  const px = typeof hideBelow === "number" ? hideBelow : HIDE_BELOW_BREAKPOINTS[hideBelow] ?? Number(hideBelow);
  const cls = HIDE_BELOW_CLASS[px];
  if (!cls) {
    if (typeof console !== "undefined") {
      console.warn(
        `[tableLayout] hideBelow=${JSON.stringify(hideBelow)} bukan breakpoint yang didukung ` +
        `(pakai salah satu: ${Object.keys(HIDE_BELOW_BREAKPOINTS).join(", ")}, atau px: ${Object.keys(HIDE_BELOW_CLASS).join(", ")}). ` +
        "Kolom tetap ditampilkan (fallback aman) — Tailwind tidak bisa men-generate class dari angka arbitrer."
      );
    }
    return "";
  }
  return cls;
}

/** `<Table fixed>` → nama class layout tabel. */
export function tableLayoutClass(fixed) {
  return fixed ? "table-fixed" : "table-auto";
}

/** `width` (number px, atau string CSS) → object `style` React untuk TH. `undefined` kalau tidak diberi (tidak menimpa style lain). */
export function widthStyle(width) {
  if (!width) return undefined; // 0/""/null/undefined semuanya "tidak diberi" — tidak ada kolom yang butuh lebar 0px
  return { width: typeof width === "number" ? `${width}px` : width };
}

/**
 * `title` otomatis untuk TD `truncate`: kalau pemanggil sudah kasih `title` eksplisit, pakai itu; kalau tidak
 * dan isinya string polos, string itu sendiri jadi title (supaya teks penuh tetap kebaca lewat hover/tap-hold
 * walau terpotong ellipsis); elemen JSX kompleks (badge + 2 baris, dll) sengaja TIDAK ditebak — `undefined`.
 */
export function autoTitle({ title, truncate, children }) {
  if (title !== undefined) return title;
  if (truncate && typeof children === "string") return children;
  return undefined;
}
