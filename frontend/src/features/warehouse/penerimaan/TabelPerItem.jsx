import React from "react";
import { cn } from "@/lib/utils.js";
import { catatanBaris, kalimatBaris, teksAngka } from "./penerimaanLogic.js";

const KOLOM = [
  { k: "dipesan", label: "Dipesan (PO)", tip: "Jumlah di PO" },
  { k: "dijadwalkan", label: "Dijadwalkan", tip: "Jumlah yang dijadwalkan pada dokumen ini" },
  { k: "tiba", label: "Tiba", tip: "Barang yang benar-benar tiba (—: belum dicatat)" },
  { k: "baik", label: "Diterima baik", tip: "Lolos pemeriksaan" },
  { k: "ditolak", label: "Ditolak", tip: "Tidak lolos pemeriksaan" },
  { k: "masukStok", label: "Masuk stok", tip: "Sudah disimpan ke stok dari dokumen ini" },
  { k: "sisaPO", label: "Sisa PO", tip: "Belum datang dari PO (pengiriman asli)" },
];

/**
 * Matriks per item: pesan · dijadwalkan · tiba · diterima · masuk stok — satu tampilan per penerimaan, tanpa modal. "—" = belum diisi (bukan nol).
 * @param editable  { tiba: bool } bila pemeriksaan boleh diisi: kolom Diterima baik/Ditolak berubah menjadi isian; Tiba hanya untuk baris tanpa PO
 * @param nilai     isian sementara { [lineId]: { acceptedQty, rejectedQty, receivedQty, condition } }
 */
export default function TabelPerItem({ rows, editable = null, nilai = {}, onUbah = () => {}, className }) {
  const isi = (b, f, awal) => (nilai[b.id] && f in nilai[b.id] ? nilai[b.id][f] : awal ?? "");
  const input = (b, f, awal, aria, ro = false) => (
    <input type="number" inputMode="decimal" min="0" step="any" value={isi(b, f, awal)} disabled={ro} onChange={(e) => onUbah(b.id, f, e.target.value)} aria-label={`${aria} ${b.kode}`} data-testid={`isian-${f}-${b.kode}`}
      className="w-20 rounded-btn border border-border bg-surface px-1.5 py-1 text-right text-[12px] tabular-nums text-ink outline-none focus:border-accent disabled:opacity-60 max-sm:min-h-11 max-sm:w-24" />
  );
  return (
    <div className={className} data-testid="tabel-per-item">
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-line text-left text-[10.5px] font-bold uppercase tracking-wide text-ink3">
              <th scope="col" className="py-1.5 pr-2">Item</th>
              {KOLOM.map((c) => <th key={c.k} scope="col" title={c.tip} className="px-1.5 py-1.5 text-right">{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.id} className="border-b border-line align-top" data-testid="baris-item" data-kode={b.kode}>
                <td className="py-2 pr-2"><div className="font-semibold text-ink">{b.kode}</div><div className="text-[11px] text-ink2">{b.nama}</div><div className="text-[10.5px] text-ink3">{b.satuan}</div>
                  {catatanBaris(b).map((c) => <div key={c} className="text-[11px] font-medium text-orange" data-testid="catatan-baris">{c}</div>)}</td>
                {KOLOM.map((c) => {
                  let sel;
                  if (editable && c.k === "baik") sel = input(b, "acceptedQty", b.baik, "Diterima baik");
                  else if (editable && c.k === "ditolak") sel = input(b, "rejectedQty", b.ditolak, "Ditolak");
                  else if (editable?.tiba && !b.dariPO && c.k === "tiba") sel = input(b, "receivedQty", b.tiba, "Tiba");
                  else sel = <span className={cn("tabular-nums", b[c.k] === null || b[c.k] === undefined ? "text-ink3" : c.k === "masukStok" && b.masukStok > 0 ? "font-semibold text-green" : "text-ink")}>{teksAngka(b[c.k])}</span>;
                  return <td key={c.k} className="px-1.5 py-2 text-right">{sel}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="m-0 list-none space-y-2 p-0 md:hidden">
        {rows.map((b) => (
          <li key={b.id} className="rounded-lg border border-line p-2.5" data-testid="kartu-item" data-kode={b.kode}>
            <div className="flex items-baseline justify-between gap-2"><span className="text-[13px] font-semibold text-ink">{b.kode}</span><span className="text-[11px] text-ink3">{b.satuan}</span></div>
            <div className="text-[12px] text-ink2">{b.nama}</div>
            <div className="mt-1 text-[11.5px] leading-snug text-ink2">{kalimatBaris(b)}</div>
            {catatanBaris(b).map((c) => <div key={c} className="mt-0.5 text-[11px] font-medium text-orange">{c}</div>)}
            {editable && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="text-[11px] text-ink3">Diterima baik{input(b, "acceptedQty", b.baik, "Diterima baik")}</label>
                <label className="text-[11px] text-ink3">Ditolak{input(b, "rejectedQty", b.ditolak, "Ditolak")}</label>
                {editable.tiba && !b.dariPO && <label className="col-span-2 text-[11px] text-ink3">Tiba{input(b, "receivedQty", b.tiba, "Tiba")}</label>}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
