import React from "react";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";

/**
 * Satu pekerjaan di Beranda (UX Gudang Tahap 4): dokumen, supplier/unit/bahan terkait, umur antrean, status, ALASAN muncul, SATU tindakan utama, dan pemilik tindakan berikutnya.
 * Mengetuk kartu membuka jendela fokus dokumen (Beranda tetap di belakangnya). Tombol tindakan hanya ada bila server menyatakan pengguna boleh; ia membuka dokumen dengan aksi itu dibuka/disorot —
 * bukan menjalankan apa pun (pengguna tetap menekan tombol akhir di dalam dokumen).
 */
export default function KartuPekerjaan({ item, onBuka, tampilSebab = false }) {
  const { aksi } = item;
  return (
    <li className="rounded-btn border border-line bg-surface" data-testid="kartu-pekerjaan" data-jenis={item.jenis} data-nomor={item.nomor}>
      <button type="button" onClick={() => onBuka(item, null)} data-testid="buka-pekerjaan"
        className="block w-full rounded-btn px-3.5 py-3 text-left transition-colors hover:bg-hovertint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset max-sm:min-h-11">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[13.5px] font-semibold text-ink [overflow-wrap:anywhere]" data-testid="nomor-pekerjaan">{item.nomor}</span>
          <Badge variant="neutral">{item.jenisLabel}</Badge>
          <Badge variant="accent" data-testid="status-pekerjaan">{item.status}</Badge>
          <span className="ml-auto text-[11.5px] text-ink3" title="Umur = sejak dokumen terakhir diubah (bukan SLA)" data-testid="umur-pekerjaan">{item.umurTeks}</span>
        </span>
        {item.terkait && <span className="mt-0.5 block text-[12px] text-ink2 [overflow-wrap:anywhere]">{item.terkait}</span>}
        <span className="mt-1 block text-[12.5px] text-ink" data-testid="alasan-pekerjaan">{item.alasan}</span>
        {tampilSebab && item.tertahan && <span className="mt-1 block text-[12.5px] font-medium text-orange" data-testid="sebab-tertahan">{item.tertahan.teks}</span>}
        <span className="mt-1 block text-[11.5px] text-ink3" data-testid="pemilik-pekerjaan">
          Yang bertindak: <strong className="font-semibold text-ink2">{item.pemilikLabel}</strong>{item.sesudahnya ? <> · Sesudahnya: {item.sesudahnya}</> : null}
        </span>
      </button>
      {aksi && (
        <div className="border-t border-line px-3.5 py-2">
          <Button size="sm" onClick={() => onBuka(item, aksi.kode)} className="max-sm:min-h-11 max-sm:w-full" data-testid="aksi-kartu" data-kode={aksi.kode}>{aksi.label}</Button>
        </div>
      )}
    </li>
  );
}
