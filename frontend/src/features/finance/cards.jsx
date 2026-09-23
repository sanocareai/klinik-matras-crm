import React from "react";
import { Card } from "@/components/ui/card.jsx";
import { cn } from "@/lib/utils.js";

// CARD LIST — pengganti TABEL di layar/kontainer sempit, bukan tabel yang
// dipaksa scroll horizontal. DUA pola pemakaian hidup berdampingan di
// halaman Finance, dan `CardList` SENGAJA netral (TIDAK membawa class
// tampil/sembunyi bawaan) supaya cocok untuk keduanya:
//
//   1. Pola CSS (viewport) — `<TableWrap>` DAN `<CardList>` dirender
//      BERSAMAAN, breakpoint CSS (`TABLE_VIEW_CLASS`/`CARD_VIEW_CLASS`,
//      dari table.jsx) yang memilih salah satu SESUAI LEBAR VIEWPORT.
//      Dipakai FinanceKasbon/FinancePayments/FinanceReceivables/
//      FinanceSuppliers — caller WAJIB mengirim
//      `<CardList className={CARD_VIEW_CLASS}>` sendiri (persis seperti
//      `<TableWrap className={cn("dh-table", TABLE_VIEW_CLASS)}>` di
//      pasangannya) supaya keduanya tetap saling eksklusif.
//
//   2. Pola JS (kontainer) — HANYA salah satu dari `<CardList>`/`<TableWrap>`
//      yang dirender sama sekali (ternary `tier === "card" ? <CardList> :
//      <TableWrap>`, lihat useContainerTier.js), TIDAK PERNAH dua-duanya
//      sekaligus di DOM. Dipakai FinanceExpenses/FinancePurchases.
//
// ⚠️ BUG PRODUKSI NYATA (24 Sep 2026) — `CardList` DULU membawa
// `CARD_VIEW_CLASS` ("md:hidden", viewport>=768px) SEBAGAI DEFAULT BAKU.
// FinanceExpenses/FinancePurchases (pola 2) TIDAK PERNAH menambahkannya
// sendiri — mengandalkan default itu apa adanya. Begitu KONTAINER sempit
// (sidebar+tab dalam-app memotong ruang, viewport tetap lebar desktop)
// `tier` jadi "card" dan JS memilih render `<CardList>` — tapi class
// bawaan itu MENYEMBUNYIKANNYA LAGI lewat CSS karena VIEWPORT (bukan
// kontainer) masih >=768px. `<TableWrap>` di cabang lain ternary itu SAMA
// SEKALI TIDAK PERNAH mounting (bukan cuma disembunyikan CSS) — hasilnya
// tabel "Daftar Pengeluaran" kosong TOTAL walau responsnya 300 baris penuh.
// Sekarang caller pola 1 yang WAJIB eksplisit menambah class-nya sendiri
// (sama seperti TableWrap sudah begitu) — pola 2 otomatis aman karena
// tidak ada lagi class tersembunyi bawaan yang bisa membatalkan pilihan JS.

/** Pembungkus daftar kartu — TANPA class tampil/sembunyi bawaan, lihat catatan di atas. */
export function CardList({ className, children }) {
  return <div className={cn("space-y-2", className)}>{children}</div>;
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
