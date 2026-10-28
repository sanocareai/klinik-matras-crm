import React, { useId, useState } from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils.js";

// IKON INFORMASI yang membuka penjelasan SEJAJAR (bukan tooltip melayang): bisa diklik/diketuk, bisa dipakai dengan keyboard (Tab lalu Enter/Spasi),
// dan tidak bergantung pada hover — jadi bekerja di HP. Penjelasan dirender di tempat (tidak di-portal) sehingga tidak terpotong atau tertutup di drawer.
// Pemakaian: const info = useInfoToggle(); <InfoToggleButton info={info} label="Cara hitung stok" /> … <InfoToggleIsi info={info}>teks</InfoToggleIsi>
export function useInfoToggle(awal = false) {
  const id = useId(); const [buka, setBuka] = useState(awal);
  return { id, buka, toggle: () => setBuka((v) => !v) };
}

export function InfoToggleButton({ info, label, className }) {
  return (
    <button type="button" onClick={info.toggle} aria-expanded={info.buka} aria-controls={info.id} aria-label={`Penjelasan: ${label}`} title={label} data-testid="info-toggle"
      className={cn("inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink3 outline-none transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/50 max-sm:h-11 max-sm:w-11", info.buka && "bg-accentbg text-accent", className)}>
      <Info size={14} strokeWidth={2} aria-hidden />
    </button>
  );
}

export function InfoToggleIsi({ info, children, className }) {
  if (!info.buka) return null;
  return <div id={info.id} role="note" data-testid="info-isi" className={cn("mt-1.5 space-y-1 rounded-btn bg-inset px-3 py-2 text-[12px] leading-relaxed text-ink2", className)}>{children}</div>;
}
