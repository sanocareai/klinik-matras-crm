import React, { useContext, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils.js";
import { TempelCtx } from "@/components/ui/fokus-overlay.jsx";
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
export default function TabelPerItem({ rows: semua, editable = null, nilai = {}, onUbah = () => {}, className }) {
  // Banyak item (PO besar): kotak cari, ringkasan, header tabel menempel saat digulir — supaya tetap ringkas dan mudah dibandingkan. Sedikit item: tampilan tidak berubah.
  const tempel = useContext(TempelCtx); // panel sempit di samping daftar: selalu kartu per item (tabel 8 kolom tidak muat)
  const [cari, setCari] = useState(""); const banyak = semua.length > 8;
  const rows = useMemo(() => { const k = cari.trim().toLowerCase(); return !banyak || !k ? semua : semua.filter((b) => `${b.kode} ${b.nama}`.toLowerCase().includes(k)); }, [semua, cari, banyak]);
  const adaCatatan = banyak ? semua.filter((b) => catatanBaris(b).length > 0).length : 0;
  const isi = (b, f, awal) => (nilai[b.id] && f in nilai[b.id] ? nilai[b.id][f] : awal ?? "");
  const input = (b, f, awal, aria, ro = false) => (
    <input type="number" inputMode="decimal" min="0" step="any" value={isi(b, f, awal)} disabled={ro} onChange={(e) => onUbah(b.id, f, e.target.value)} aria-label={`${aria} ${b.kode}`} data-testid={`isian-${f}-${b.kode}`}
      className="w-20 rounded-btn border border-border bg-surface px-1.5 py-1 text-right text-[12px] tabular-nums text-ink outline-none focus:border-accent disabled:opacity-60 max-sm:min-h-11 max-sm:w-24" />
  );
  return (
    <div className={className} data-testid="tabel-per-item">
      {banyak && (
        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1.5" data-testid="ringkas-item">
          <span className="text-[12px] text-ink2"><strong className="text-ink">{semua.length}</strong> item{adaCatatan > 0 && <> · <strong className="text-orange">{adaCatatan}</strong> perlu dicek</>}{cari && <> · {rows.length} cocok</>}</span>
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs"><Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink3" aria-hidden />
            <input type="search" value={cari} onChange={(e) => setCari(e.target.value)} placeholder="Cari item di dokumen ini" aria-label="Cari item di dokumen ini" data-testid="cari-item" className="w-full rounded-btn border border-border bg-surface py-1.5 pl-8 pr-2 text-[12.5px] text-ink outline-none focus:border-accent max-sm:min-h-11" /></div>
        </div>
      )}
      {banyak && rows.length === 0 && <p className="m-0 py-3 text-[12.5px] text-ink3" data-testid="item-tak-cocok">Tidak ada item yang cocok dengan “{cari}”.</p>}
      <div className={cn(tempel ? "hidden" : "hidden overflow-x-auto md:block", banyak && "max-h-[44vh] overflow-y-auto")}>
        <table className="w-full border-collapse text-[12.5px]">
          <thead className={banyak ? "sticky top-0 z-[1] bg-surface" : undefined}>
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
      <ul className={cn("gud-item-daftar m-0 list-none space-y-2 p-0", !tempel && "md:hidden")}>
        {rows.map((b) => (
          <li key={b.id} className="gud-item" data-testid="kartu-item" data-kode={b.kode}>
            <div className="gud-item-kepala"><div className="min-w-0"><span className="gud-item-nama">{b.nama || b.kode}</span><span className="gud-item-kode">{b.kode}</span></div><span className="gud-item-satuan">{b.satuan}</span></div>
            <div className="gud-item-angka">
              <label><span>Tiba</span>{editable?.tiba && !b.dariPO ? input(b, "receivedQty", b.tiba, "Tiba") : <strong>{teksAngka(b.tiba)}</strong>}</label>
              <label><span>Baik</span>{editable ? input(b, "acceptedQty", b.baik, "Diterima baik") : <strong>{teksAngka(b.baik)}</strong>}</label>
              <label><span>Ditolak</span>{editable ? input(b, "rejectedQty", b.ditolak, "Ditolak") : <strong>{teksAngka(b.ditolak)}</strong>}</label>
            </div>
            <div className="gud-item-kalimat">{kalimatBaris(b)}</div>
            {catatanBaris(b).map((c) => <div key={c} className="gud-item-catatan">{c}</div>)}
          </li>
        ))}
      </ul>
    </div>
  );
}
