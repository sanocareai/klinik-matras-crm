import React from "react";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { Button } from "@/components/ui/button.jsx";
import { cn } from "@/lib/utils.js";
import { pesanGalatAdopsi } from "@/features/production/orderProduksiModel.js";

// Hasil satu tindakan di profil unit: sukses (hijau) atau galat yang dijelaskan (konflik = oranye + "Muat ulang"). Dipindah dari panel Order Produksi lama.
export function Hasil({ hasil, onMuat }) {
  const g = hasil.galat ? pesanGalatAdopsi(hasil.galat) : null;
  if (hasil.ok) return <p role="status" data-testid="hasil-ok" className="m-0 mt-3 flex items-start gap-2 rounded-btn bg-greenbg px-3 py-2 text-[12.5px] text-green"><CheckCircle2 size={15} className="mt-0.5 shrink-0" aria-hidden />{hasil.ok}</p>;
  if (!g) return null;
  return (
    <div role="alert" data-testid="hasil-galat" className={cn("mt-3 rounded-btn px-3 py-2 text-[12.5px]", g.jenis === "konflik" || g.jenis === "info" ? "bg-orangebg text-orange" : "bg-redbg text-red")}>
      <p className="m-0 flex items-start gap-2 font-medium">{g.jenis === "info" ? <Info size={15} className="mt-0.5 shrink-0" aria-hidden /> : <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden />}{g.teks}</p>
      {g.petunjuk && <p className="m-0 mt-0.5 pl-6">{g.petunjuk}</p>}
      {g.muatUlang && <Button variant="secondary" size="sm" className="ml-6 mt-2 min-h-[40px]" onClick={onMuat}>Muat ulang</Button>}
    </div>
  );
}
