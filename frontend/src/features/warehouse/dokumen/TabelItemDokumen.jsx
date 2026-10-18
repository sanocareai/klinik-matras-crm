import React from "react";
import { cn } from "@/lib/utils.js";
import { TableWrap, Table, THead, TBody, TR, TH, TD } from "@/components/ui/table.jsx";

/**
 * Daftar item dokumen Gudang: tabel pada layar lebar, kartu per item pada HP (tanpa scroll horizontal).
 * @param baris  [{ id, kode, nama, sel: [{ kunci, label, isi: node, numeric?, tebal? }], peringatan?: string }]
 * Kolom tabel diambil dari `sel` baris pertama; urutan & label sel harus sama antar-baris.
 */
export default function TabelItemDokumen({ baris = [], className }) {
  if (!baris.length) return <p className="m-0 text-[12.5px] text-ink3">Tidak ada item.</p>;
  const kolom = baris[0].sel;
  return (
    <div className={className} data-testid="item-dokumen">
      <TableWrap className="hidden md:block">
        <Table>
          <THead><TR><TH>Bahan</TH>{kolom.map((k) => <TH key={k.kunci} numeric={k.numeric}>{k.label}</TH>)}</TR></THead>
          <TBody>
            {baris.map((b) => (
              <TR key={b.id} data-testid="baris-item" data-kode={b.kode}>
                <TD><div className="font-semibold text-ink">{b.kode}</div><div className="text-[11px] text-ink3">{b.nama}</div>{b.peringatan && <div role="note" className="mt-0.5 text-[11px] font-semibold text-red" data-testid="peringatan-item">{b.peringatan}</div>}</TD>
                {b.sel.map((k) => <TD key={k.kunci} numeric={k.numeric} className={cn(k.tebal && "font-semibold text-ink")}>{k.isi}</TD>)}
              </TR>
            ))}
          </TBody>
        </Table>
      </TableWrap>
      <ul className="m-0 list-none space-y-2.5 p-0 md:hidden">
        {baris.map((b) => (
          <li key={b.id} className="rounded-btn border border-border p-3" data-testid="kartu-item" data-kode={b.kode}>
            <div className="text-[13px] font-semibold text-ink">{b.kode}</div>
            <div className="text-[11.5px] text-ink3">{b.nama}</div>
            {b.peringatan && <div role="note" className="mt-1 text-[11.5px] font-semibold text-red" data-testid="peringatan-item">{b.peringatan}</div>}
            <dl className="m-0 mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12px]">
              {b.sel.map((k) => <div key={k.kunci} className={k.lebar ? "col-span-2" : undefined}><dt className="text-ink3">{k.label}</dt><dd className={cn("m-0 text-ink", k.tebal && "font-semibold")}>{k.isi}</dd></div>)}
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}
