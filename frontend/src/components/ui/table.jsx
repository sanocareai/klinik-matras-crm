import React from "react";
import { ArrowUp, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils.js";
import { hideBelowClass, tableLayoutClass, widthStyle, autoTitle, HIDE_BELOW_BREAKPOINTS } from "@/lib/tableLayout.js";

export { HIDE_BELOW_BREAKPOINTS };

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
export function TR({ className, clickable, selected, ...props }) {
  return (
    <tr
      className={cn(
        "border-b border-line last:border-0 transition-colors duration-100",
        clickable && "cursor-pointer",
        selected ? "bg-accentbg/60" : clickable && "hover:bg-hovertint",
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
export function TH({
  className, children, numeric, sortable, sortDir, onSort, sticky, width, hideBelow, style, ...props
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
        "whitespace-nowrap border-b border-line px-3 py-2.5 text-[11px] font-bold uppercase tracking-wide text-ink3",
        numeric ? "text-right" : "text-left",
        sticky && "tbl-sticky-th",
        hideBelowClass(hideBelow),
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
//   sticky  : pasangan TH sticky — lihat catatan di TH. Latar solid
//     (bukan transparan) supaya konten yang di-scroll di baliknya benar-
//     benar tertutup, bukan cuma dijaga anggapan.
export function TD({ className, numeric, truncate, sticky, hideBelow, title, children, ...props }) {
  const judul = autoTitle({ title, truncate, children });
  return (
    <td
      className={cn(
        "px-3 py-2.5 align-middle text-[13px] text-ink2",
        numeric && "text-right tabular-nums",
        truncate && "truncate max-w-0 w-full",
        sticky && "tbl-sticky-td",
        hideBelowClass(hideBelow),
        className
      )}
      title={judul}
      {...props}
    >
      {children}
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
