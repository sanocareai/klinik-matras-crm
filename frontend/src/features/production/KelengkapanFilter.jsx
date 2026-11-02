import React from "react";
import { Button } from "@/components/ui/button.jsx";
import DateRangePicker from "@/components/DateRangePicker.jsx";
import { InfoToggleButton, InfoToggleIsi, useInfoToggle } from "@/components/ui/info-toggle.jsx";
import { cn } from "@/lib/utils.js";
import { DASAR_PERIODE_TEKS, KELENGKAPAN_BUKAN, KELENGKAPAN_FILTER, URUTAN_DAFTAR } from "@/features/production/orderProduksiModel.js";

// Penyaring cepat KELENGKAPAN + periode + urutan untuk Order Produksi. Jumlah per kategori dan total unik datang dari SERVER atas SELURUH unit yang cocok (bukan halaman yang dimuat).
// Satu unit boleh ada di beberapa kategori → jumlah per kategori boleh melebihi total unik; total gabungan menghitung unit unik.
export default function KelengkapanFilter({ hitung, memuat, terpilih, onToggle, onBersih, periode, onPeriode, urut, onUrut, scope, onLihatRiwayat }) {
  const info = useInfoToggle();
  const infoPeriode = useInfoToggle();
  const belumDinilai = hitung?.dataOrder?.belumDinilai ?? 0;
  const adaRiwayat = scope !== "riwayat" && !!onLihatRiwayat && (hitung?.riwayat?.unik ?? 0) > 0;
  return (
    <div className="prod-kelengkapan" data-testid="kelengkapan-filter">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Saring kelengkapan data">
        <span className="text-[12.5px] font-medium text-ink2">Kelengkapan</span>
        <InfoToggleButton info={info} label="Cara menghitung kelengkapan" />
        {KELENGKAPAN_FILTER.map((k) => {
          const n = hitung?.counts?.[k.key]; const on = terpilih.includes(k.key);
          return (
            <button key={k.key} type="button" aria-pressed={on} data-testid={`kel-${k.key}`} title={k.bantu} onClick={() => onToggle(k.key)}
              className={cn("prod-chip", on && "aktif")}>
              {k.label}<span className="ml-1.5 text-[12px] opacity-80" data-testid={`kel-n-${k.key}`}>{memuat && n === undefined ? "…" : n ?? 0}</span>
            </button>
          );
        })}
        {terpilih.length > 0 && <Button variant="ghost" size="sm" className="min-h-[40px] max-sm:min-h-[44px]" data-testid="kel-bersih" onClick={onBersih}>Hapus pilihan</Button>}
        <span className="ml-auto text-[12.5px] text-ink3" data-testid="kel-unik" title="Unit unik yang punya setidaknya satu kekurangan pada lingkup dan filter yang sedang aktif (satu unit boleh masuk beberapa kategori).">
          {hitung ? `${hitung.unik} unit berkekurangan` : memuat ? "Menghitung…" : ""}
        </span>
      </div>
      {belumDinilai > 0 && <p className="m-0 text-[12.5px] text-ink3" data-testid="kel-belum-dinilai">Data order: {belumDinilai} unit belum dinilai (order biasa belum punya aturan wajib) — bukan lengkap, dan tidak dihitung sebagai kekurangan.</p>}
      <InfoToggleIsi info={info}>
        <p className="m-0">Jumlah dihitung server atas seluruh unit yang cocok dengan lingkup, pencarian, status kerja, dan periode yang aktif. Satu unit boleh masuk beberapa kategori; “unit berkekurangan” menghitung unit unik.</p>
        <p className="m-0">{KELENGKAPAN_BUKAN}</p>
        <p className="m-0">HPP = HPP operasional (harga berlaku Gudang), bukan biaya Finance. Pilihan lebih dari satu = salah satu cocok.</p>
      </InfoToggleIsi>

      <div className="flex flex-wrap items-end gap-3" data-testid="periode-urutan">
        <div className="text-[12px] font-medium text-ink3" data-testid="periode-blok">
          <span className="flex items-center gap-1">Periode order masuk <InfoToggleButton info={infoPeriode} label="Dasar tanggal periode" /></span>
          <div className="mt-0.5" data-testid="periode-picker"><DateRangePicker value={periode} onChange={onPeriode} showCompare={false} /></div>
        </div>
        <label className="text-[12px] font-medium text-ink3">Urutan
          <select value={urut} onChange={(e) => onUrut(e.target.value)} aria-label="Urutan daftar" data-testid="urutan-daftar"
            className="prod-pilih mt-0.5 block">
            {URUTAN_DAFTAR.map((u) => <option key={u.key} value={u.key}>{u.label}</option>)}
          </select>
        </label>
      </div>
      <InfoToggleIsi info={infoPeriode}>
        <p className="m-0" data-testid="dasar-periode">Dasar tanggal: {DASAR_PERIODE_TEKS}. Hari dihitung menurut WIB dan tanggal akhir ikut penuh (sampai 23.59 WIB). "Semua waktu" = tanpa batas tanggal. Periode berlaku sama untuk daftar, jumlah kelengkapan, Aktif/Semua/Riwayat, dan Excel.</p>
      </InfoToggleIsi>
      {adaRiwayat && (
        <p className="m-0 text-[12.5px] text-ink2" data-testid="kel-riwayat">
          {hitung.riwayat.unik} unit Terkirim juga berkekurangan.{" "}
          <button type="button" className="inline-flex min-h-[44px] items-center font-semibold text-accent underline sm:min-h-0" data-testid="kel-lihat-riwayat" onClick={onLihatRiwayat}>Lihat di Riwayat</button>
        </p>
      )}
    </div>
  );
}
