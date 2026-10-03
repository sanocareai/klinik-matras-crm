import React from "react";
import { Input } from "@/components/ui/input.jsx";
import { angkaSaring } from "@/features/finance/rekonBankLogic.js";

// Rentang nominal (Rp) untuk menyaring mutasi. Diketik bebas ("1.500.000"); server memvalidasi.
export default function SaringNominal({ min, maks, onMin, onMaks }) {
  const salah = angkaSaring(min) && angkaSaring(maks) && Number(angkaSaring(min)) > Number(angkaSaring(maks));
  return (
    <div className="flex flex-wrap items-center gap-2 px-1 text-[12.5px] text-ink2" data-testid="saring-nominal">
      <span className="font-medium">Nominal</span>
      <Input inputMode="decimal" value={min} onChange={(e) => onMin(e.target.value)} placeholder="min (Rp)" aria-label="Nominal minimum" className="h-9 w-[130px]" />
      <span aria-hidden>–</span>
      <Input inputMode="decimal" value={maks} onChange={(e) => onMaks(e.target.value)} placeholder="maks (Rp)" aria-label="Nominal maksimum" className="h-9 w-[130px]" />
      {salah && <span role="alert" className="text-red">Minimum lebih besar dari maksimum</span>}
    </div>
  );
}
