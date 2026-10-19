import React from "react";
import { api } from "@/api.js";
import { Badge } from "@/components/ui/badge.jsx";
import { Card } from "@/components/ui/card.jsx";
import { HalamanDokumen, useDokumen } from "@/features/warehouse/dokumen/KartuDokumen.jsx";
import { Detail } from "./KoreksiDokumenTab.jsx";
import { STATUS_KOREKSI, JENIS_KOREKSI } from "./koreksiLogic.js";

/** Koreksi Gudang sebagai JENDELA FOKUS (UX Gudang Tahap 4): sebelum→sesudah, rencana pergerakan stok, keputusan; setujui/tolak/batal memakai jalur resmi yang sama dengan daftar. */
export default function KoreksiFokus({ id, onTutup, onBerubah }) {
  const { r: k, galat, memuat, muat } = useDokumen(api.getKoreksiGudang, id, onBerubah);
  if (!k) return <HalamanDokumen r={k} memuat={memuat} galat={galat} onTutup={onTutup} onMuat={muat} nama="koreksi" />;
  return (
    <HalamanDokumen judul={k.nomor} subjudul={`${JENIS_KOREKSI[k.jenis] ?? k.jenis} · ${k.nomorDokumen} · diajukan ${k.pemohon?.name ?? "—"}`} onTutup={onTutup} r={k} memuat={memuat} galat={galat} onMuat={muat} nama="koreksi">
      <Card className="space-y-2 p-4" data-testid="kartu-identitas">
        <div className="flex flex-wrap items-center gap-2"><Badge variant={STATUS_KOREKSI[k.status]?.warna ?? "neutral"} data-testid="status-dokumen" data-kode={k.status}>{STATUS_KOREKSI[k.status]?.label ?? k.status}</Badge></div>
        <p className="m-0 text-[12.5px] text-ink2" data-testid="penjelasan-stok">{k.pratinjau?.operasi?.length ? "Koreksi ini mengubah stok SETELAH disetujui orang lain; sebelum itu stok tidak berubah." : "Koreksi informasi saja — tidak mengubah stok."}</p>
      </Card>
      <Card className="p-0"><Detail k={k} aksi={muat} /></Card>
    </HalamanDokumen>
  );
}
