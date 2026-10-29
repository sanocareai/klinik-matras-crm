import React from "react";
import { Info } from "lucide-react";
import { Button } from "@/components/ui/button.jsx";
import { InfoToggleButton, InfoToggleIsi, useInfoToggle } from "@/components/ui/info-toggle.jsx";
import { cn } from "@/lib/utils.js";
import { DASAR_PERIODE_TEKS, KELENGKAPAN_BUKAN, KELENGKAPAN_FILTER, URUTAN_DAFTAR } from "@/features/production/orderProduksiModel.js";

// Penyaring cepat KELENGKAPAN + periode + urutan untuk Order Produksi. Jumlah per kategori dan total unik datang dari SERVER atas SELURUH unit yang cocok (bukan halaman yang dimuat).
// Satu unit boleh ada di beberapa kategori → jumlah per kategori boleh melebihi total unik; total gabungan menghitung unit unik.
export default function KelengkapanFilter({ hitung, memuat, terpilih, onToggle, onBersih, dari, sampai, onDari, onSampai, galatPeriode, urut, onUrut, scope, onLihatRiwayat }) {
  const info = useInfoToggle();
  const belumDinilai = hitung?.dataOrder?.belumDinilai ?? 0;
  const adaRiwayat = scope !== "riwayat" && !!onLihatRiwayat && (hitung?.riwayat?.unik ?? 0) > 0;
  return (
    <div className="space-y-2" data-testid="kelengkapan-filter">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Saring kelengkapan data">
        <span className="text-[12.5px] font-medium text-ink2">Kelengkapan</span>
        <InfoToggleButton info={info} label="Cara menghitung kelengkapan" />
        {KELENGKAPAN_FILTER.map((k) => {
          const n = hitung?.counts?.[k.key]; const on = terpilih.includes(k.key);
          return (
            <button key={k.key} type="button" aria-pressed={on} data-testid={`kel-${k.key}`} title={k.bantu} onClick={() => onToggle(k.key)}
              className={cn("min-h-[40px] rounded-chip border px-3 py-1.5 text-[13px] font-semibold transition-colors motion-reduce:transition-none max-sm:min-h-[44px]", on ? "border-accent bg-accentbg text-accent" : "border-line bg-surface text-ink2 hover:bg-hovertint")}>
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
        <label className="text-[12px] font-medium text-ink3">Order masuk dari
          <input type="date" value={dari} onChange={(e) => onDari(e.target.value)} aria-label="Order masuk dari tanggal" data-testid="periode-dari" aria-invalid={!!galatPeriode}
            className="mt-0.5 block h-11 rounded-btn border border-line bg-surface px-2 text-[14px] text-ink outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30" />
        </label>
        <label className="text-[12px] font-medium text-ink3">sampai
          <input type="date" value={sampai} onChange={(e) => onSampai(e.target.value)} aria-label="Order masuk sampai tanggal" data-testid="periode-sampai" aria-invalid={!!galatPeriode}
            className="mt-0.5 block h-11 rounded-btn border border-line bg-surface px-2 text-[14px] text-ink outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30" />
        </label>
        {(dari || sampai) && <Button variant="ghost" size="sm" className="min-h-[44px]" data-testid="periode-hapus" onClick={() => { onDari(""); onSampai(""); }}>Hapus periode</Button>}
        <label className="text-[12px] font-medium text-ink3">Urutan
          <select value={urut} onChange={(e) => onUrut(e.target.value)} aria-label="Urutan daftar" data-testid="urutan-daftar"
            className="mt-0.5 block h-11 rounded-btn border border-line bg-surface px-2 text-[14px] text-ink outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30">
            {URUTAN_DAFTAR.map((u) => <option key={u.key} value={u.key}>{u.label}</option>)}
          </select>
        </label>
        <p className="m-0 flex items-center gap-1 pb-3 text-[12px] text-ink3" data-testid="dasar-periode"><Info size={12} aria-hidden /> Dasar tanggal: {DASAR_PERIODE_TEKS}</p>
      </div>
      {galatPeriode && <p role="alert" className="m-0 text-[12.5px] text-red" data-testid="periode-galat">{galatPeriode}</p>}
      {adaRiwayat && (
        <p className="m-0 text-[12.5px] text-ink2" data-testid="kel-riwayat">
          {hitung.riwayat.unik} unit Terkirim juga berkekurangan.{" "}
          <button type="button" className="inline-flex min-h-[44px] items-center font-semibold text-accent underline sm:min-h-0" data-testid="kel-lihat-riwayat" onClick={onLihatRiwayat}>Lihat di Riwayat</button>
        </p>
      )}
    </div>
  );
}
