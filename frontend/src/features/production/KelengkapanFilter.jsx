import React from "react";
import { Button } from "@/components/ui/button.jsx";
import { InfoToggleButton, InfoToggleIsi, useInfoToggle } from "@/components/ui/info-toggle.jsx";
import { cn } from "@/lib/utils.js";
import { DASAR_PERIODE_TEKS, KELENGKAPAN_BUKAN, KELENGKAPAN_FILTER } from "@/features/production/orderProduksiModel.js";

// Ringkasan KELENGKAPAN untuk daftar Order Produksi (dibuka dari "Filter lainnya"): empat kategori + jumlah unik. Jumlah per kategori dan total unik datang dari SERVER atas SELURUH unit yang cocok
// (bukan halaman yang dimuat). Satu unit boleh ada di beberapa kategori → jumlah per kategori TIDAK dijumlahkan; total gabungan menghitung unit unik.
// "Belum dinilai" (order biasa tanpa aturan wajib) dipisah dari kekurangan dan dari "lengkap". Periode + urutan kini ada di baris filter utama daftar (bukan di sini).
export default function KelengkapanFilter({ hitung, memuat, terpilih, onToggle, onBersih, scope, onLihatRiwayat }) {
  const info = useInfoToggle();
  const belumDinilai = hitung?.dataOrder?.belumDinilai ?? 0;
  const adaRiwayat = scope !== "riwayat" && !!onLihatRiwayat && (hitung?.riwayat?.unik ?? 0) > 0;
  return (
    <div className="prod-kelengkapan" data-testid="kelengkapan-filter">
      <div className="prod-kel-kepala" role="group" aria-label="Saring kelengkapan data">
        <span className="prod-kel-judul">Kelengkapan data</span>
        <InfoToggleButton info={info} label="Cara menghitung kelengkapan" />
        <span className="prod-kel-unik" data-testid="kel-unik" title="Unit unik yang punya setidaknya satu kekurangan pada lingkup dan filter yang sedang aktif. Satu unit boleh masuk beberapa kategori, jadi angka kategori tidak dijumlahkan.">
          {hitung ? `${hitung.unik} unit berkekurangan` : memuat ? "Menghitung…" : ""}
        </span>
      </div>
      <div className="prod-kel-chips" role="group" aria-label="Kategori kekurangan">
        {KELENGKAPAN_FILTER.map((k) => {
          const n = hitung?.counts?.[k.key]; const on = terpilih.includes(k.key);
          return (
            <button key={k.key} type="button" aria-pressed={on} data-testid={`kel-${k.key}`} title={k.bantu} onClick={() => onToggle(k.key)} className={cn("prod-chip", on && "aktif")}>
              {k.label}<span data-testid={`kel-n-${k.key}`}>{memuat && n === undefined ? "…" : n ?? 0}</span>
            </button>
          );
        })}
        {terpilih.length > 0 && <Button variant="ghost" size="sm" className="min-h-[44px]" data-testid="kel-bersih" onClick={onBersih}>Hapus pilihan</Button>}
      </div>
      <p className="prod-kel-catatan" data-testid="kel-tumpang">Satu unit boleh masuk beberapa kategori; pilihan lebih dari satu berarti salah satu cocok.</p>
      {belumDinilai > 0 && <p className="prod-kel-catatan belum" data-testid="kel-belum-dinilai"><b>{belumDinilai} unit belum dinilai</b> — order biasa belum punya aturan kelengkapan wajib. Ini bukan “lengkap” dan tidak dihitung sebagai kekurangan.</p>}
      <InfoToggleIsi info={info}>
        <p className="m-0">Jumlah dihitung server atas seluruh unit yang cocok dengan lingkup, pencarian, status kerja, dan periode yang aktif. “Unit berkekurangan” menghitung unit unik.</p>
        <p className="m-0">{KELENGKAPAN_BUKAN}</p>
        <p className="m-0">HPP = HPP operasional (harga berlaku Gudang), bukan biaya Finance.</p>
        <p className="m-0" data-testid="dasar-periode">Periode di baris filter memakai: {DASAR_PERIODE_TEKS}. Hari dihitung menurut WIB dan tanggal akhir ikut penuh (sampai 23.59 WIB); “Semua waktu” = tanpa batas tanggal. Periode berlaku sama untuk daftar, jumlah kelengkapan, Aktif/Semua/Riwayat, dan Excel.</p>
      </InfoToggleIsi>
      {adaRiwayat && (
        <p className="prod-kel-catatan" data-testid="kel-riwayat">
          {hitung.riwayat.unik} unit Terkirim juga berkekurangan.{" "}
          <button type="button" className="prod-tautan" data-testid="kel-lihat-riwayat" onClick={onLihatRiwayat}>Lihat di Riwayat</button>
        </p>
      )}
    </div>
  );
}
