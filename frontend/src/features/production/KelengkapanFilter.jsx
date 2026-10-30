import React, { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button.jsx";
import DateRangePicker from "@/components/DateRangePicker.jsx";
import { InfoToggleButton, InfoToggleIsi, useInfoToggle } from "@/components/ui/info-toggle.jsx";
import { cn } from "@/lib/utils.js";
import {
  DASAR_PERIODE_TEKS, KELENGKAPAN_BUKAN, KELENGKAPAN_FILTER, KELENGKAPAN_KEYS, MASALAH_GABUNGAN, MASALAH_SEMUA, URUTAN_DAFTAR, nilaiJenisMasalah, pilihanDariJenisMasalah,
} from "@/features/production/orderProduksiModel.js";

// Penyaring KELENGKAPAN (ringkas) + periode + urutan untuk Order Produksi.
//   · Satu pintasan "Perlu dilengkapi · N" (N = unit unik dari SERVER atas seluruh unit yang cocok, bukan halaman yang dimuat) = keempat jenis digabung (salah satu cocok).
//   · Satu dropdown "Jenis masalah" (Semua masalah / satu jenis). Gabungan beberapa jenis ada di panel "Pilih beberapa" (kotak centang; hubungan tetap OR).
//   · Tombol hapus pilihan hanya tampil bila ada pilihan aktif. Klasifikasi/hitungan/OR tidak diubah di sini — komponen ini hanya mengatur pilihan dan menampilkan angka server.
export default function KelengkapanFilter({ hitung, memuat, terpilih, onToggle, onPilih, onBersih, periode, onPeriode, urut, onUrut, scope, onLihatRiwayat }) {
  const info = useInfoToggle();
  const infoPeriode = useInfoToggle();
  const [panel, setPanel] = useState(false);
  const belumDinilai = hitung?.dataOrder?.belumDinilai ?? 0;
  const adaRiwayat = scope !== "riwayat" && !!onLihatRiwayat && (hitung?.riwayat?.unik ?? 0) > 0;
  const nilai = nilaiJenisMasalah(terpilih); const semuaAktif = nilai === MASALAH_SEMUA; const aktif = terpilih.length > 0;
  const angka = (n) => (memuat && n === undefined ? "…" : n ?? 0);
  const jumlahUnik = hitung ? hitung.unik : memuat ? "…" : 0;
  return (
    <div className="space-y-2" data-testid="kelengkapan-filter">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Saring kelengkapan data">
        <span className="text-[12.5px] font-medium text-ink2">Kelengkapan</span>
        <InfoToggleButton info={info} label="Cara menghitung kelengkapan" />
        <button type="button" aria-pressed={semuaAktif} data-testid="kel-perlu" title="Unit unik yang punya setidaknya satu kekurangan pada lingkup dan filter yang sedang aktif. Sama dengan memilih “Semua masalah”."
          onClick={() => onPilih(semuaAktif ? [] : [...KELENGKAPAN_KEYS])}
          className={cn("min-h-[40px] rounded-chip border px-3 py-1.5 text-[13px] font-semibold transition-colors motion-reduce:transition-none max-sm:min-h-[44px]", semuaAktif ? "border-accent bg-accentbg text-accent" : "border-line bg-surface text-ink2 hover:bg-hovertint")}>
          Perlu dilengkapi<span className="ml-1.5 text-[12px] opacity-80">· <span data-testid="kel-unik">{jumlahUnik}</span></span>
        </button>
        <label className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink2">
          <span>Jenis masalah</span>
          <select value={nilai} onChange={(e) => onPilih(pilihanDariJenisMasalah(e.target.value))} aria-label="Jenis masalah" data-testid="kel-jenis"
            className={cn("h-10 rounded-btn border bg-surface px-2 text-[13.5px] text-ink outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30 max-sm:h-11", aktif ? "border-accent" : "border-line")}>
            <option value="">Semua unit</option>
            <option value={MASALAH_SEMUA}>Semua masalah ({angka(hitung?.unik)})</option>
            {KELENGKAPAN_FILTER.map((k) => <option key={k.key} value={k.key}>{k.label} ({angka(hitung?.counts?.[k.key])})</option>)}
            {nilai === MASALAH_GABUNGAN && <option value={MASALAH_GABUNGAN}>Gabungan ({terpilih.length} jenis)</option>}
          </select>
        </label>
        <button type="button" aria-expanded={panel} aria-controls="kel-panel" data-testid="kel-panel-buka" onClick={() => setPanel((v) => !v)}
          className="inline-flex min-h-[40px] items-center gap-1 rounded-btn px-2 text-[12.5px] font-medium text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent/40 max-sm:min-h-[44px]">
          Pilih beberapa<ChevronDown size={14} aria-hidden className={cn("transition-transform motion-reduce:transition-none", panel && "rotate-180")} />
        </button>
        {aktif && <Button variant="ghost" size="sm" className="min-h-[40px] max-sm:min-h-[44px]" data-testid="kel-bersih" onClick={onBersih}>Hapus pilihan</Button>}
      </div>
      {panel && (
        <fieldset id="kel-panel" data-testid="kel-panel" className="m-0 rounded-btn border border-line bg-inset px-3 py-2">
          <legend className="px-1 text-[12px] font-medium text-ink3">Gabungkan jenis masalah (cukup salah satu cocok)</legend>
          <div className="grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
            {KELENGKAPAN_FILTER.map((k) => (
              <label key={k.key} className="flex min-h-[40px] cursor-pointer items-center gap-2 text-[13px] text-ink2 max-sm:min-h-[44px]" title={k.bantu}>
                <input type="checkbox" checked={terpilih.includes(k.key)} onChange={() => onToggle(k.key)} data-testid={`kel-cek-${k.key}`} className="h-4 w-4 accent-[var(--accent,#2563eb)]" />
                <span>{k.label}</span><span className="text-[12px] text-ink3" data-testid={`kel-n-${k.key}`}>{angka(hitung?.counts?.[k.key])}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {belumDinilai > 0 && <p className="m-0 text-[12.5px] text-ink3" data-testid="kel-belum-dinilai">Data order: {belumDinilai} unit belum dinilai (order biasa belum punya aturan wajib) — bukan lengkap, dan tidak dihitung sebagai kekurangan.</p>}
      <InfoToggleIsi info={info}>
        <p className="m-0">“Perlu dilengkapi” = jumlah unit unik yang punya setidaknya satu kekurangan; dihitung server atas seluruh unit yang cocok dengan lingkup, pencarian, status kerja, dan periode yang aktif. Satu unit boleh masuk beberapa jenis, jadi angka per jenis boleh melebihi total.</p>
        {KELENGKAPAN_FILTER.map((k) => <p key={k.key} className="m-0"><span className="font-medium text-ink">{k.label}.</span> {k.bantu}</p>)}
        <p className="m-0">{KELENGKAPAN_BUKAN}</p>
        <p className="m-0">Biaya bahan = HPP operasional (harga berlaku Gudang pada waktu pemakaian), bukan nilai persediaan dan bukan biaya Finance. Memilih lebih dari satu jenis = salah satu cocok.</p>
      </InfoToggleIsi>

      <div className="flex flex-wrap items-end gap-3" data-testid="periode-urutan">
        <div className="text-[12px] font-medium text-ink3" data-testid="periode-blok">
          <span className="flex items-center gap-1">Periode order masuk <InfoToggleButton info={infoPeriode} label="Dasar tanggal periode" /></span>
          <div className="mt-0.5" data-testid="periode-picker"><DateRangePicker value={periode} onChange={onPeriode} showCompare={false} /></div>
        </div>
        <label className="text-[12px] font-medium text-ink3">Urutan
          <select value={urut} onChange={(e) => onUrut(e.target.value)} aria-label="Urutan daftar" data-testid="urutan-daftar"
            className="mt-0.5 block h-11 rounded-btn border border-line bg-surface px-2 text-[14px] text-ink outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30">
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
