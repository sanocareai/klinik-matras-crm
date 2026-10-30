import React from "react";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import { InfoToggleButton, InfoToggleIsi, useInfoToggle } from "@/components/ui/info-toggle.jsx";
import { cn } from "@/lib/utils.js";
import { KELENGKAPAN_BUKAN, labelKelengkapan, ringkasBaris } from "@/features/production/orderProduksiModel.js";

// Kelengkapan PER BARIS di daftar Order Produksi: SATU alasan utama (yang paling bisa ditindaklanjuti) + "+N masalah" bila ada yang lain + ikon info (semua alasan konkret) + SATU tombol "Lengkapi" yang membuka bagian terkait di drawer.
// Klasifikasi datang dari server (row.adopsi.kelengkapan) — sama dengan filter, drawer, dan ekspor; ringkasBaris hanya mengatur apa yang ditampilkan lebih dulu.
// Biaya bahan yang hanya akibat masalah bahan (dibaca dari kode + jumlah alasan server) tidak ditumpuk; masalah harga yang berdiri sendiri tetap tampil sebagai label kedua (tidak disembunyikan). Menampilkan/membuka ini tidak menulis apa pun.
export default function KelengkapanBaris({ row, onLengkapi, tampilTombol = true, className }) {
  const info = useInfoToggle();
  const kel = row?.adopsi?.kelengkapan; const r = ringkasBaris(row);
  if (!kel || !r.semua.length) return null;
  const label = (k) => labelKelengkapan(k, kel.items[k]?.label ?? k);
  return (
    <div className={cn("mt-1.5 space-y-1", className)} data-testid="kelengkapan-baris-ringkas" data-kunci={r.semua.join(",")} data-utama={r.utama} onClick={(e) => e.stopPropagation()}>
      <div className="flex flex-wrap items-center gap-1">
        <Badge variant="orange" className="normal-case tracking-normal text-[11.5px]" data-testid="kelengkapan-label" data-kunci={r.utama}>{label(r.utama)}</Badge>
        {r.terlihat.map((k) => <Badge key={k} variant="orange" className="normal-case tracking-normal text-[11.5px]" data-testid="kelengkapan-label" data-kunci={k}>{label(k)}</Badge>)}
        {r.lain.length > 0 && (
          <button type="button" onClick={info.toggle} aria-expanded={info.buka} aria-controls={info.id} data-testid="kelengkapan-lain" title="Tampilkan semua masalah unit ini"
            className="inline-flex min-h-[28px] items-center rounded-chip border border-line bg-surface px-2 text-[11.5px] font-semibold text-ink2 outline-none hover:bg-hovertint focus-visible:ring-2 focus-visible:ring-accent/50 max-sm:min-h-[44px]">
            +{r.lain.length} masalah
          </button>
        )}
        <InfoToggleButton info={info} label={`Alasan kekurangan ${row.unitCode}`} />
        {tampilTombol && <Button variant="secondary" size="sm" className="min-h-[36px] max-sm:min-h-[44px]" data-testid="lengkapi-baris" data-sasaran={r.sasaran} onClick={(e) => { e.stopPropagation(); onLengkapi?.(row, r.sasaran); }}>Lengkapi</Button>}
      </div>
      <InfoToggleIsi info={info} className="max-w-[420px]">
        {r.semua.map((k) => (
          <div key={k} data-testid="kelengkapan-info-item" data-kunci={k}>
            <p className="m-0 font-medium text-ink">{label(k)}</p>
            <ul className="m-0 list-disc pl-4">{(kel.items[k]?.alasan ?? []).map((a) => <li key={a.kode}>{a.teks}</li>)}</ul>
            {r.terlipat.includes(k) && <p className="m-0 text-ink3" data-testid="kelengkapan-terlipat">Tidak ditampilkan terpisah di baris: penyebabnya sama dengan “{(r.lipatDari[k] ?? []).map((d) => labelKelengkapan(d)).join(", ")}”.</p>}
          </div>
        ))}
        <p className="m-0 text-ink3">{KELENGKAPAN_BUKAN}</p>
      </InfoToggleIsi>
    </div>
  );
}
