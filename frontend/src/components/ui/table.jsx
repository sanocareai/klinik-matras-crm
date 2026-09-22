import React from "react";
import { ArrowUp, ArrowDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils.js";
import {
  hideBelowClass, tableLayoutClass, widthStyle, autoTitle, HIDE_BELOW_BREAKPOINTS,
  midOnlyClass, EXPAND_TOGGLE_HIDE_CLASS, TABLE_VIEW_CLASS, CARD_VIEW_CLASS,
} from "@/lib/tableLayout.js";

export { HIDE_BELOW_BREAKPOINTS, TABLE_VIEW_CLASS, CARD_VIEW_CLASS };

// ─── TABLE (Attio-inspired) — primitive tabel padat ──────────────────────────
// Spec: docs/design-system/sano-components.md §B.3 "Tables (Attio-inspired)".
// SENGAJA DITUNDA dari Wave 0 supaya dirancang bareng konsumen NYATA-nya
// (tabel Pelanggan), bukan abstraksi spekulatif — lihat catatan "Deferred from
// Wave 0" di rencana migrasi.
//
// Ciri: header sticky, garis pemisah sehalus mungkin (hairline), angka
// rata-KANAN + tabular-nums, hover baris, header bisa di-sort, baris skeleton
// saat loading. TANPA animasi saat scroll — tabel harus terasa instan.
//
// Dipakai dengan komposisi, bukan config besar:
//   <TableWrap><Table>
//     <THead><TR><TH sortable ...>Nama</TH><TH numeric>Nilai</TH></TR></THead>
//     <TBody><TR clickable onClick={...}><TD>..</TD><TD numeric>..</TD></TR></TBody>
//   </Table></TableWrap>

// Pembungkus scroll horizontal. Tabel padat SELALU lebih lebar dari layar
// sempit — ini yang menjaga halaman tidak ikut geser (bukan body yang scroll).
export function TableWrap({ className, children, ...props }) {
  return (
    <div
      className={cn(
        "w-full overflow-x-auto rounded-2xl bg-surface",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

// `fixed` (D-193, lebar layar) — OPT-IN `table-layout: fixed`. Tabel dengan
// banyak kolom (8+) memakai ini SUPAYA lebar kolom mengikuti `width` yang
// diberi ke `TH` (bukan lebar konten terlebar di kolom itu) — itu yang
// membuat kolom "Keterangan" bisa memakai sisa ruang (tanpa width, atau
// `w-full`) sementara kolom sempit (Nomor/Tanggal/Nominal/Status) tetap
// ringkas, dan `truncate` di TD punya batas nyata untuk memotong teks.
// Tabel sederhana (≤5 kolom) TIDAK perlu ini — lebar otomatis sudah cukup.
export function Table({ className, fixed, ...props }) {
  return <table className={cn("w-full border-collapse text-sm", tableLayoutClass(fixed), className)} {...props} />;
}

// `<colgroup>` — cara EKSPLISIT & kanonik menetapkan lebar kolom di
// `table-layout: fixed` (dibanding cuma `width` per-TH, yang juga masih
// dipakai/didukung TH/TD di bawah). Taruh SEBAGAI ANAK PERTAMA `<Table>`,
// sebelum `<THead>`. `widths`: array sepanjang jumlah kolom — number (px),
// string CSS, atau `undefined`/`null` untuk kolom fleksibel (dibiarkan
// tanpa `width` eksplisit, mengambil sisa ruang — biasanya "Keterangan").
export function ColGroup({ widths = [] }) {
  return (
    <colgroup>
      {widths.map((w, i) => (
        <col key={i} style={w ? widthStyle(w) : undefined} />
      ))}
    </colgroup>
  );
}

export function THead({ className, ...props }) {
  // sticky + z-10: header tetap terlihat saat body tabel di-scroll vertikal.
  // Latar SOLID (bukan tembus pandang) — baris yang lewat di baliknya saat
  // scroll vertikal harus benar-benar tertutup, bukan cuma diredam opacity.
  return (
    <thead
      className={cn("sticky top-0 z-10 bg-inset", className)}
      {...props}
    />
  );
}

export function TBody({ className, ...props }) {
  return <tbody className={cn(className)} {...props} />;
}

// clickable: baris jadi tombol (buka drawer). selected: state terpilih.
// `data-selected` (bukan cuma className `bg-accentbg/60`) — dibaca CSS
// `tr[data-selected="true"] .tbl-sticky-td` di tokens.css supaya kolom
// sticky (mis. "Nomor") ikut berubah warna saat baris terpilih, bukan
// tetap warna normalnya sendiri (lihat komentar di tokens.css).
//
// Hover SEKARANG selalu aktif untuk SEMUA baris (bukan cuma `clickable`)
// — "hover row halus" (D-XXX, 22 Sep 2026): tabel data biasa (bukan cuma
// yang barisnya bisa diklik) tetap dapat highlight lembut saat kursor
// lewat, konsisten dengan tabel lain yang lebih interaktif.
export function TR({ className, clickable, selected, ...props }) {
  return (
    <tr
      data-selected={selected ? "true" : undefined}
      className={cn(
        "border-b border-line last:border-0 transition-colors duration-100",
        clickable && "cursor-pointer",
        selected ? "bg-accentbg/60" : "hover:bg-hovertint/70",
        className
      )}
      {...props}
    />
  );
}

// TH — header kolom.
//   numeric   : rata kanan (angka)
//   sortable  : bisa diklik untuk sort; butuh onSort
//   sortDir   : "asc" | "desc" | null — arah aktif kolom INI
//   sticky    : OPT-IN — kolom ini menempel di tepi kiri saat tabel
//     di-scroll horizontal (dipakai untuk kolom identitas baris, mis.
//     "Nomor", supaya tidak hilang konteks saat swipe ke kanan lihat
//     nominal/status di tabel lebar pada layar sempit). TIDAK PERNAH
//     nyala default — halaman lama yang tidak memakainya tidak berubah
//     sama sekali.
// `width`   : lebar kolom TETAP — number (px) atau string CSS ("8rem", "12%").
//   Dipasang lewat `style`, bukan Tailwind arbitrary class, supaya bisa
//   angka dinamis tanpa perlu masuk safelist. Hanya berarti pada `<Table fixed>`.
// `hideBelow`: lihat `hideBelowClass` di atas — kolom sekunder yang boleh
//   hilang di layar sedang (1024–1365px), fallback ke scroll tabel di layar
//   sempit (bukan halaman ikut geser).
// `mid`: OPT-IN — kolom ini HANYA tampil 1280–1599px (lihat `midOnlyClass`
//   di tableLayout.js). Dipakai untuk kolom GABUNGAN (mis. "Klasifikasi" =
//   Kategori+Divisi) yang menggantikan beberapa kolom detail terpisah
//   (ber-`hideBelow="uw"`) selama lebar itu belum cukup untuk menampilkan
//   semuanya terpisah tanpa membuat kolom lain (Aksi/Bukti) bertumpuk.
export function TH({
  className, children, numeric, sortable, sortDir, onSort, sticky, width, hideBelow, mid, style, ...props
}) {
  const isi = (
    <>
      {children}
      {sortable && (
        // Ikon hanya muncul untuk kolom yang SEDANG di-sort; kolom sortable
        // lain memberi petunjuk lewat cursor + hover, bukan ikon permanen
        // (biar header tidak ramai).
        <span className="inline-flex w-3 justify-center align-middle">
          {sortDir === "asc" ? <ArrowUp size={11} /> : sortDir === "desc" ? <ArrowDown size={11} /> : null}
        </span>
      )}
    </>
  );

  return (
    <th
      scope="col"
      aria-sort={sortable ? (sortDir === "asc" ? "ascending" : sortDir === "desc" ? "descending" : "none") : undefined}
      className={cn(
        "whitespace-nowrap border-b border-line px-3 py-3.5 text-[11px] font-bold uppercase tracking-wide text-ink3",
        numeric ? "text-right" : "text-left",
        sticky && "tbl-sticky-th",
        hideBelowClass(hideBelow),
        mid && midOnlyClass(),
        className
      )}
      style={{ ...widthStyle(width), ...style }}
      {...props}
    >
      {sortable ? (
        <button
          type="button"
          onClick={onSort}
          className={cn(
            "inline-flex items-center gap-1 uppercase tracking-wide transition-colors duration-100 hover:text-ink",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded",
            sortDir && "text-ink2"
          )}
        >
          {isi}
        </button>
      ) : isi}
    </th>
  );
}

// TD — sel data.
//   numeric : rata kanan + tabular-nums (angka sejajar antar baris)
//   truncate: batasi 1 baris + ellipsis. `max-w-0 w-full` memaksa cell
//     menghormati lebar KOLOM (dari `TH width`, pada `<Table fixed>`) alih-
//     alih melebar mengikuti teksnya sendiri — tanpa ini `truncate` tidak
//     bekerja di dalam tabel (sel selalu tumbuh muat teksnya). Teks penuh
//     tetap terbaca lewat `title` — diisi OTOMATIS dari `children` kalau
//     berupa string polos dan pemanggil belum memberi `title` sendiri
//     (elemen JSX kompleks, mis. dua baris teks, tetap butuh `title` manual).
//   hideBelow: lihat catatan di TH — HARUS sama dengan TH pasangannya di
//     kolom yang sama, kalau tidak header & isi kolom tidak lagi sejajar.
//   mid     : lihat catatan di TH — HARUS sama dengan TH pasangannya.
//   clamp2  : dua baris + ellipsis (bukan satu) — dipakai kolom fleksibel
//     "Keterangan" supaya isi panjang tetap terbaca sebagian alih-alih
//     terpotong jadi satu baris pendek. Beda dari `truncate` (1 baris):
//     ⚠️ `line-clamp-2` (Tailwind) HARUS dipasang di SPAN PEMBUNGKUS DI
//     DALAM `<td>`, BUKAN di elemen `<td>` itu sendiri — `line-clamp`
//     memaksa `display: -webkit-box`, dan begitu computed display sebuah
//     `<td>` bukan lagi `table-cell`, algoritma `table-layout: fixed`
//     TIDAK LAGI menganggapnya kolom yang sah: kolom itu KOLAPS ke ~lebar
//     padding saja (terbukti lewat pengukuran nyata: Keterangan yang
//     seharusnya dapat ratusan px sisa ruang cuma dapat 24px, computed
//     display `flow-root`) — bug yang PERSIS terlihat seperti "kolom lain
//     bertumpuk di atasnya" walau sebenarnya cuma kolom ini kolaps. `<td>`
//     WAJIB tetap `table-cell` murni; `max-w-0 w-full` (trik yang sama
//     dengan `truncate`) tetap dipasang di `<td>` supaya lebarnya
//     dipatok kolom, sedangkan `-webkit-line-clamp`-nya sendiri pindah
//     ke `<span>` di dalamnya yang boleh berdisplay apa saja tanpa
//     mempengaruhi table layout.
//   sticky  : pasangan TH sticky — lihat catatan di TH. Latar solid
//     (bukan transparan) supaya konten yang di-scroll di baliknya benar-
//     benar tertutup, bukan cuma dijaga anggapan.
export function TD({ className, numeric, truncate, clamp2, sticky, hideBelow, mid, title, children, ...props }) {
  const judul = autoTitle({ title, truncate: truncate || clamp2, children });
  return (
    <td
      className={cn(
        // py-4 (16px atas+bawah) + tinggi baris teks (~20px pada text-[13px])
        // ≈ 52px, dan `min-h-[58px]` (literal lengkap, lihat catatan
        // tableLayout.js soal Tailwind tidak bisa scan class dinamis)
        // memaksa sisanya — beberapa browser tidak konsisten menghormati
        // min-height murni di <td>, jadi py-4 tetap jadi jaring pengaman
        // utama, min-h cuma penambal untuk baris yang isinya sangat pendek.
        "min-h-[58px] px-3 py-4 align-middle text-[13px] text-ink2",
        numeric && "text-right tabular-nums",
        truncate && "truncate max-w-0 w-full",
        clamp2 && "max-w-0 w-full",
        sticky && "tbl-sticky-td",
        hideBelowClass(hideBelow),
        mid && midOnlyClass(),
        className
      )}
      title={judul}
      {...props}
    >
      {clamp2 ? <span className="line-clamp-2 break-words">{children}</span> : children}
    </td>
  );
}

// Baris skeleton saat loading — jumlah kolom disesuaikan supaya lebarnya tidak
// melompat begitu data nyata masuk (hindari layout shift).
export function TableSkeletonRows({ rows = 8, cols = 6 }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} className="border-b border-line last:border-0">
          {Array.from({ length: cols }).map((_, c) => (
            <td key={c} className="px-3 py-3">
              <div
                className="h-3.5 animate-pulse rounded bg-inset"
                // Lebar bervariasi supaya terasa seperti teks, bukan balok seragam
                style={{ width: c === 0 ? "70%" : `${45 + ((r + c) % 3) * 15}%` }}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

// Satu baris penuh untuk pesan kosong — colSpan diisi pemanggil.
export function TableEmptyRow({ colSpan, children }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center text-[13px] text-ink3">
        {children}
      </td>
    </tr>
  );
}

// ─── EXPAND TOGGLE + DETAIL ROW (768–1279px) ─────────────────────────────────
// Di 1280px ke atas kolom detail tampil sendiri (hideBelow="uw") atau
// digabung (mid). Di bawah 768px tabel diganti Card List sama sekali. Di
// antara keduanya (768–1279px) kolom detail disembunyikan TOTAL dari tabel
// (bukan dipaksa muat) — pasangan tombol ini yang membukanya per baris,
// supaya datanya tetap bisa dibaca tanpa membuat kolom Aksi/Bukti/Status
// yang WAJIB selalu terlihat jadi sempit.

/** Tombol buka/tutup baris detail. Pemanggil menyimpan state `open` sendiri (per baris) — komponen ini murni tampilan. */
export function ExpandToggle({ open, onClick, label = "Detail" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      aria-label={open ? `Tutup ${label.toLowerCase()}` : `Buka ${label.toLowerCase()}`}
      className={cn(
        EXPAND_TOGGLE_HIDE_CLASS,
        "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ink3 transition-colors duration-100",
        "hover:bg-hovertint hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      )}
    >
      <ChevronRight size={14} className={cn("transition-transform duration-150", open && "rotate-90")} />
    </button>
  );
}

/**
 * Baris detail (colSpan penuh) berisi field yang disembunyikan dari tabel
 * di 768–1279px. `fields`: [{ label, value }] — `value` boleh string atau
 * elemen JSX (mis. Badge); title hover hanya dipasang otomatis untuk string.
 * Ber-`EXPAND_TOGGLE_HIDE_CLASS` sendiri (bukan cuma mengandalkan `open`
 * dari state JS) — kalau layar melebar ke >=1280 saat baris ini terbuka,
 * baris tetap hilang lewat CSS walau state `open` belum sempat direset.
 */
export function DetailRow({ open, colSpan, fields = [] }) {
  if (!open) return null;
  return (
    <tr className={cn(EXPAND_TOGGLE_HIDE_CLASS, "border-b border-line bg-inset/60")}>
      <td colSpan={colSpan} className="px-4 py-3">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-3">
          {fields.map((f, i) => (
            <div key={f.label ?? i} className="min-w-0">
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-ink3">{f.label}</dt>
              <dd
                className="mt-0.5 truncate text-[13px] text-ink"
                title={typeof f.value === "string" ? f.value : undefined}
              >
                {f.value ?? <span className="text-ink3">—</span>}
              </dd>
            </div>
          ))}
        </dl>
      </td>
    </tr>
  );
}
