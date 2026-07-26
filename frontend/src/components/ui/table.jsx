import React from "react";
import { ArrowUp, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils.js";

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

export function Table({ className, ...props }) {
  return <table className={cn("w-full border-collapse text-sm", className)} {...props} />;
}

export function THead({ className, ...props }) {
  // sticky + z-10: header tetap terlihat saat body tabel di-scroll vertikal.
  return (
    <thead
      className={cn("sticky top-0 z-10 bg-inset/95 backdrop-blur-sm", className)}
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
export function TH({
  className, children, numeric, sortable, sortDir, onSort, ...props
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
        className
      )}
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
//   truncate: batasi 1 baris + ellipsis (butuh `max-w-*` dari pemanggil)
export function TD({ className, numeric, truncate, ...props }) {
  return (
    <td
      className={cn(
        "px-3 py-2.5 align-middle text-[13px] text-ink2",
        numeric && "text-right tabular-nums",
        truncate && "truncate",
        className
      )}
      {...props}
    />
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
