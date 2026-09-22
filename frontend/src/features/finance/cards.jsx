import React from "react";
import { Card } from "@/components/ui/card.jsx";
import { CARD_VIEW_CLASS } from "@/components/ui/table.jsx";
import { cn } from "@/lib/utils.js";

// CARD LIST (<768px) — pengganti TABEL di layar sempit, bukan tabel yang
// dipaksa scroll horizontal. `<TableWrap>` (yang membungkus `<Table>`) sudah
// disembunyikan di bawah 768px lewat `TABLE_VIEW_CLASS` (halaman yang
// memakai kartu ini juga memakai class itu di pembungkus tabelnya) — jadi
// TIDAK PERNAH dua-duanya terlihat sekaligus.

/** Pembungkus daftar kartu — HANYA terlihat <768px (kebalikan `TABLE_VIEW_CLASS`). */
export function CardList({ className, children }) {
  return <div className={cn(CARD_VIEW_CLASS, "space-y-2", className)}>{children}</div>;
}

/**
 * Satu kartu = satu baris tabel. `title` = identitas ringkas (nomor
 * dokumen, biasanya monospace, sejajar posisinya dengan kolom sticky di
 * tabel). `status` = badge kanan atas. `subtitle` = nama/keterangan utama
 * (maks 2 baris). `fields` = [{ label, value }] field sekunder yang di
 * tabel disembunyikan 768–1279px — di kartu SELALU terlihat (tidak ada
 * lagi alasan menyembunyikannya, kartu sudah memakai lebar penuh layar).
 * `actions` = biasanya <RowActions/>, ditaruh di baris footer terpisah.
 * `onClick` OPSIONAL — dipakai untuk kartu yang perannya "buka detail"
 * (Jurnal, Pemasukan, Rekonsiliasi) DAN TIDAK punya `actions` terpisah,
 * supaya tidak ada tombol bersarang di dalam elemen yang bisa diklik.
 */
export function RowCard({ title, status, subtitle, fields = [], actions, onClick, className }) {
  return (
    <Card
      className={cn("overflow-hidden p-3", onClick && "cursor-pointer transition-colors hover:bg-hovertint", className)}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(e); } } : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {title && <p className="truncate font-mono text-[12px] text-ink3">{title}</p>}
          {subtitle && <p className="mt-0.5 line-clamp-2 break-words text-[14px] font-medium text-ink">{subtitle}</p>}
        </div>
        {status && <div className="shrink-0">{status}</div>}
      </div>
      {fields.length > 0 && (
        <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-line pt-2.5">
          {fields.map((f, i) => (
            <div key={f.label ?? i} className={cn("min-w-0", f.span && "col-span-2")}>
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
      )}
      {actions && (
        <div className="mt-2.5 flex justify-end border-t border-line pt-2.5" onClick={(e) => e.stopPropagation()}>
          {actions}
        </div>
      )}
    </Card>
  );
}
