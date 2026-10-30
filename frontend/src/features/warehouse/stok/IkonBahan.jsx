import React from "react";
import { AlertTriangle, Box, Boxes, Cable, Droplets, Layers, Scissors, Spline, TreePine, Wrench } from "lucide-react";
import { cn } from "@/lib/utils.js";

// Ikon KELOMPOK bahan (bukan foto): data bahan tidak menyimpan gambar. Kode kelompok datang dari server (tabel eksplisit), jadi ikon tidak menebak dari nama.
export const IKON_KELOMPOK = { BUSA: Layers, KAIN: Scissors, BENANG: Spline, PEGAS: Cable, KAYU: TreePine, LEM_KIMIA: Droplets, AKSESORI: Wrench, LAINNYA: Box, BELUM: AlertTriangle };

export default function IkonBahan({ kode, ukuran = "md", className }) {
  const Ikon = IKON_KELOMPOK[kode] ?? Boxes; const belum = kode === "BELUM";
  const kotak = ukuran === "lg" ? "h-14 w-14 rounded-2xl" : "h-11 w-11 rounded-xl"; const ikon = ukuran === "lg" ? 26 : 20;
  return (
    <span aria-hidden className={cn("flex shrink-0 items-center justify-center", kotak, belum ? "bg-orangebg text-orange" : "bg-blue-50 text-blue-700", className)} data-testid="ikon-bahan" data-kelompok={kode ?? ""}>
      <Ikon size={ikon} strokeWidth={1.75} />
    </span>
  );
}
