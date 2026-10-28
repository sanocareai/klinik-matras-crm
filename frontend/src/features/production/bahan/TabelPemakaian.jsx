import React, { useState } from "react";
import { Pencil, X } from "lucide-react";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import { cn } from "@/lib/utils.js";
import { formatJumlah } from "@/features/production/orderProduksiModel.js";
import { LABEL_JENIS_PEMAKAIAN, barisTabelPemakaian } from "@/features/production/bahan/bahanModel.js";
import EditPemakaianForm from "@/features/production/bahan/EditPemakaianForm.jsx";
import { BarisSementara } from "@/features/production/bahan/PemakaianSementaraDaftar.jsx";
import KomponenLamaDaftar from "@/features/production/bahan/KomponenLamaDaftar.jsx";
import "@/features/production/bahan/bahan.css";

// TABEL PEMAKAIAN AKTUAL — satu tabel untuk tiga sumber (Bahan Gudang · Bahan belum tercatat · Komponen lama), tanpa menjumlahkan antar-sumber. Tiap baris: bahan, jumlah, DAMPAK singkat, dan tombol Edit.
// Edit memakai formulir yang SUDAH ada dan tetap menegakkan pratinjau dampak, izin, alasan, aturan harga, dan persetujuan (Gudang: EditPemakaianForm; sementara: koreksi/batal/rekonsiliasi; komponen lama: koreksi/salah input).
// Susunan memakai grid ber-peran tabel agar di HP tiap baris menjadi kartu ringkas (bahan + jumlah, lalu dampak + Edit) tanpa gulir mendatar.
const GRID = "grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 sm:grid-cols-[minmax(0,1.7fr)_minmax(0,0.8fr)_minmax(0,1.5fr)_auto] sm:items-center";

const Sel = ({ label, className, children, kolom }) => <div role="cell" data-kolom={kolom} className={className}><span className="sr-only sm:hidden">{label}: </span>{children}</div>;

export default function TabelPemakaian({ unitId, data, izin, aktif, terkirim, rencanaEdit = false, menunggu = [], editId, onEditGudang, onTutupGudang, onHasilEdit, onDone, kodeUnit }) {
  const rows = barisTabelPemakaian(data, { menunggu });
  const [bukaId, setBukaId] = useState(null); // baris sementara/komponen lama yang diperluas (detail + aksi yang sudah ada)
  const bolehGudang = !!izin.pemakaianAktual && (aktif || terkirim) && !rencanaEdit;
  const bolehSementara = !!izin.catatPemakaianSementara && aktif; const bolehGdgSem = !!izin.putuskanUsulan;
  const bolehLama = !!izin.pemakaianAktual && aktif;
  if (!rows.length) return null;
  return (
    <div role="table" aria-label="Pemakaian aktual per bahan" className="min-w-0 overflow-hidden rounded-card border border-line" data-testid="tabel-pemakaian">
      <div role="row" className={cn(GRID, "bg-inset px-3 py-1.5 text-[11.5px] font-medium uppercase tracking-[0.05em] text-ink3 max-sm:hidden")}>
        <div role="columnheader">Bahan</div><div role="columnheader" className="text-right">Jumlah</div><div role="columnheader">Dampak</div><div role="columnheader" className="w-[84px]"><span className="sr-only">Tindakan</span></div>
      </div>
      <div className="divide-y divide-line">
        {rows.map((r) => {
          const editGudang = r.jenis === "gudang" && editId === r.materialId; const terbuka = r.jenis !== "gudang" && bukaId === r.key;
          const bisaEdit = r.jenis === "gudang" ? bolehGudang : r.jenis === "sementara" ? (bolehSementara || bolehGdgSem) : bolehLama;
          const label = r.jenis === "gudang" ? "Edit" : bisaEdit ? "Edit" : "Detail";
          const klik = () => { if (r.jenis === "gudang") onEditGudang(r.materialId); else setBukaId(terbuka ? null : r.key); };
          return (
            <React.Fragment key={r.key}>
              <div role="row" className={cn(GRID, "px-3 py-2.5")} data-testid="aktual-tabel-baris" data-jenis={r.jenis} data-material-id={r.materialId || undefined}>
                <Sel label="Bahan" kolom="bahan" className="min-w-0">
                  <span className="block truncate text-[13.5px] font-medium text-ink">{r.nama}</span>
                  <span className="block truncate text-[11.5px] text-ink3">{[LABEL_JENIS_PEMAKAIAN[r.jenis], r.kode].filter(Boolean).join(" · ")}{r.asal ? ` · asal: ${r.asal}` : ""}</span>
                </Sel>
                <Sel label="Jumlah" kolom="jumlah" className={cn("text-right text-[13.5px] font-semibold tabular-nums", r.melebihi ? "text-orange" : "text-ink")}>
                  {formatJumlah(r.qty)} {r.satuan}{r.melebihi && <span className="block text-[11px] font-normal">melebihi rencana</span>}
                </Sel>
                <Sel label="Dampak" kolom="dampak" className="col-span-1 flex min-w-0 flex-wrap items-center gap-1 sm:col-auto">
                  {r.chips.map((c) => <Badge key={c.key} variant={c.tone} className={c.tone === "orange" ? "bh-b-orange" : undefined} data-testid={`dampak-${c.key}`}>{c.label}{c.detail ? ` ${c.detail}` : ""}</Badge>)}
                </Sel>
                <Sel label="Tindakan" kolom="aksi" className="justify-self-end">
                  {!(editGudang || terbuka) && (r.jenis !== "gudang" || bisaEdit) && <Button variant="neutral" size="sm" className="min-h-[44px] min-w-[44px]" onClick={klik} data-testid={r.jenis === "gudang" ? "edit-bahan" : r.jenis === "sementara" ? "edit-sementara" : "edit-komponen"} aria-label={`${label} pemakaian ${r.nama}`}>{label === "Edit" ? <Pencil size={13} aria-hidden /> : null} {label}</Button>}
                  {(editGudang || terbuka) && <Button variant="tertiary" size="sm" className="min-h-[44px] min-w-[44px]" onClick={() => (r.jenis === "gudang" ? onTutupGudang() : setBukaId(null))} aria-label={`Tutup ${r.nama}`} data-testid="edit-tutup"><X size={14} aria-hidden /> Tutup</Button>}
                </Sel>
              </div>
              {editGudang && (
                <div className="px-3 pb-3"><EditPemakaianForm key={r.materialId} unitId={unitId} selesai={terkirim} baris={{ materialId: r.materialId, nama: r.nama, kode: r.kode, satuan: r.satuan, aktual: r.qty }} izin={izin} menunggu={r.menunggu}
                  onTutup={onTutupGudang} onSelesai={async (h) => { onTutupGudang(); onHasilEdit?.({ ...h, bahan: r.nama }); await onDone(); }} /></div>
              )}
              {terbuka && r.jenis === "sementara" && <ul className="m-0 list-none px-3 pb-3 p-0" data-testid="detail-sementara"><BarisSementara item={r.item} bolehCatat={bolehSementara} bolehGudang={bolehGdgSem} aktif={aktif} onDone={async () => { setBukaId(null); await onDone(); }} /></ul>}
              {terbuka && r.jenis === "lama" && <div className="px-3 pb-3" data-testid="detail-komponen"><KomponenLamaDaftar unitId={unitId} kodeUnit={kodeUnit} data={{ items: [r.item], dibatalkan: [] }} bolehUbah={bolehLama} aktif={aktif} meta={{ fotoMaks: 3 }} onDone={async () => { setBukaId(null); await onDone(); }} /></div>}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
