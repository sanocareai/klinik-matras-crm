import React, { useMemo } from "react";
import { Card } from "@/components/ui/card.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD, TableSkeletonRows } from "@/components/ui/table.jsx";
import { FilterTahapDokumen, StatusDokumen } from "./FilterTahapDokumen.jsx";
import { cocokCari, filterTahap, hitungPerTahap } from "./dokumenLogic.js";

/**
 * Daftar dokumen Gudang (pola sederhana): tab tahap berhitung + pencarian + tabel (desktop) + kartu (HP); klik → halaman detail.
 * @param kolom [{ label, isi:(r)=>node, numeric?, kelas? }] — kolom terakhir otomatis Status (dari server `tampilan`)
 * @param kartu (r)=>({ judul, baris:[node,…] }) — isi kartu HP
 * @param kosong { icon, judul, deskripsi, aksi }
 */
export default function DaftarSederhana({ filters, rows, loading, error, tahap, onTahap, cari, onCari, placeholder, labelCari, labelTab, kolom, kartu, nomor, teks, onBuka, kosong, aksiKepala }) {
  const hitung = useMemo(() => (rows ? hitungPerTahap(filters, rows) : null), [filters, rows]);
  const terfilter = useMemo(() => (rows ? filterTahap(filters, rows, tahap).filter((r) => cocokCari(teks(r), cari)) : null), [filters, rows, tahap, cari, teks]);
  const adaFilter = !!(cari || tahap); const kosongSekarang = !loading && terfilter && terfilter.length === 0;
  return (
    <div className="space-y-3">
      <FilterTahapDokumen filters={filters} aktif={tahap} hitung={hitung} onPilih={onTahap} cari={cari} onCari={onCari} placeholder={placeholder} labelCari={labelCari} labelTab={labelTab} />
      {aksiKepala}
      {error && <div role="alert" className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{error}</div>}
      <Card className="overflow-hidden p-0">
        {kosongSekarang ? (
          <EmptyState icon={kosong.icon} title={adaFilter ? "Tidak ada dokumen yang cocok" : kosong.judul} description={adaFilter ? "Ubah pencarian atau tahap." : kosong.deskripsi} action={!adaFilter ? kosong.aksi : undefined} />
        ) : (
          <>
            <TableWrap className="hidden md:block">
              <Table>
                <THead><TR>{kolom.map((k) => <TH key={k.label} numeric={k.numeric}>{k.label}</TH>)}<TH>Status</TH></TR></THead>
                <TBody>
                  {loading && <TableSkeletonRows rows={6} cols={kolom.length + 1} />}
                  {!loading && terfilter?.map((r) => (
                    <TR key={r.id} clickable onClick={() => onBuka(r)} data-testid="baris-dokumen" data-nomor={nomor(r)}>
                      {kolom.map((k) => <TD key={k.label} numeric={k.numeric} className={k.kelas}>{k.isi(r)}</TD>)}
                      <TD className="min-w-[160px]"><StatusDokumen r={r} /></TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
            <ul className="m-0 list-none divide-y divide-line p-0 md:hidden">
              {!loading && terfilter?.map((r) => {
                const k = kartu(r);
                return (
                  <li key={r.id}>
                    <button type="button" onClick={() => onBuka(r)} data-testid="baris-dokumen" data-nomor={nomor(r)}
                      className="w-full px-4 py-3 text-left transition-colors hover:bg-hovertint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset max-sm:min-h-11">
                      <div className="flex items-start gap-2"><span className="text-[13px] font-semibold text-ink">{k.judul}</span><span className="ml-auto shrink-0"><StatusDokumen r={r} /></span></div>
                      {k.baris.map((b, i) => <div key={i} className="mt-0.5 text-[12px] text-ink2">{b}</div>)}
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}
