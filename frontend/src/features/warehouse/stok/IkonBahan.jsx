import React, { useEffect, useState } from "react";
import { AlertTriangle, Box, Boxes, Cable, Droplets, Layers, Scissors, Spline, TreePine, Wrench } from "lucide-react";
import { cn } from "@/lib/utils.js";

// Penanda bahan: FOTO bila ada (thumbnail dari server), kalau tidak ikon KELOMPOK. Kode kelompok datang dari server (tabel eksplisit), jadi ikon tidak menebak dari nama.
// Foto gagal dimuat (berkas hilang / offline) → kembali ke ikon, tidak pernah ikon rusak.
export const IKON_KELOMPOK = { BUSA: Layers, KAIN: Scissors, BENANG: Spline, PEGAS: Cable, KAYU: TreePine, LEM_KIMIA: Droplets, AKSESORI: Wrench, LAINNYA: Box, BELUM: AlertTriangle };

export default function IkonBahan({ kode, ukuran = "md", className, fotoUrl = null }) {
  const [rusak, setRusak] = useState(false);
  useEffect(() => { setRusak(false); }, [fotoUrl]);
  const Ikon = IKON_KELOMPOK[kode] ?? Boxes; const belum = kode === "BELUM";
  const kotak = ukuran === "lg" ? "h-14 w-14 rounded-2xl" : "h-11 w-11 rounded-xl"; const ikon = ukuran === "lg" ? 26 : 20;
  if (fotoUrl && !rusak) {
    return (
      <span aria-hidden className={cn("flex shrink-0 overflow-hidden bg-inset", kotak, className)} data-testid="ikon-bahan" data-kelompok={kode ?? ""} data-foto="1">
        <img src={fotoUrl} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" onError={() => setRusak(true)} />
      </span>
    );
  }
  return (
    <span aria-hidden className={cn("flex shrink-0 items-center justify-center", kotak, belum ? "bg-orangebg text-orange" : "bg-blue-50 text-blue-700", className)} data-testid="ikon-bahan" data-kelompok={kode ?? ""}>
      <Ikon size={ikon} strokeWidth={1.75} />
    </span>
  );
}
