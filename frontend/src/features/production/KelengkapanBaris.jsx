import React from "react";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import { InfoToggleButton, InfoToggleIsi, useInfoToggle } from "@/components/ui/info-toggle.jsx";
import { cn } from "@/lib/utils.js";
import { KELENGKAPAN_BUKAN, kunciKelengkapan, sasaranLengkapi } from "@/features/production/orderProduksiModel.js";

// Label kelengkapan PER BARIS di daftar Order Produksi: label pendek + ikon info (alasan konkret) + SATU tombol "Lengkapi" yang membuka bagian relevan di drawer.
// Klasifikasi datang dari server (row.adopsi.kelengkapan) — sama dengan filter, drawer, dan ekspor. Menampilkan/membuka ini tidak menulis apa pun.
export default function KelengkapanBaris({ row, onLengkapi, tampilTombol = true, className }) {
  const info = useInfoToggle();
  const kel = row?.adopsi?.kelengkapan; const keys = kunciKelengkapan(row);
  if (!kel || !keys.length) return null;
  const sasaran = sasaranLengkapi(keys);
  return (
    <div className={cn("mt-1.5 space-y-1", className)} data-testid="kelengkapan-baris-ringkas" data-kunci={keys.join(",")} onClick={(e) => e.stopPropagation()}>
      <div className="flex flex-wrap items-center gap-1">
        {keys.map((k) => <Badge key={k} variant="orange" className="normal-case tracking-normal text-[11.5px]" data-testid="kelengkapan-label" data-kunci={k}>{kel.items[k]?.label ?? k}</Badge>)}
        <InfoToggleButton info={info} label={`Alasan kekurangan ${row.unitCode}`} />
        {tampilTombol && <Button variant="secondary" size="sm" className="min-h-[36px] max-sm:min-h-[44px]" data-testid="lengkapi-baris" data-sasaran={sasaran} onClick={(e) => { e.stopPropagation(); onLengkapi?.(row, sasaran); }}>Lengkapi</Button>}
      </div>
      <InfoToggleIsi info={info} className="max-w-[420px]">
        {keys.map((k) => (
          <div key={k} data-testid="kelengkapan-info-item"><p className="m-0 font-medium text-ink">{kel.items[k]?.label}</p><ul className="m-0 list-disc pl-4">{(kel.items[k]?.alasan ?? []).map((a) => <li key={a.kode}>{a.teks}</li>)}</ul></div>
        ))}
        <p className="m-0 text-ink3">{KELENGKAPAN_BUKAN}</p>
      </InfoToggleIsi>
    </div>
  );
}
