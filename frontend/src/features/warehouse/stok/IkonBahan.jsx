import React from "react";
import { cn } from "@/lib/utils.js";
import { IkBenang, IkGunting, IkKayu, IkKotak, IkLapis, IkPegas, IkPerkakas, IkTanya, IkTetes, IkAwas } from "@/components/gudangIcons.jsx";

// Ikon KELOMPOK bahan (bukan foto): data bahan tidak menyimpan gambar. Kode kelompok datang dari server (tabel eksplisit), jadi ikon tidak menebak dari nama.
// Redesain Gudang (3 Nov 2026): satu keluarga SVG garis (components/gudangIcons.jsx), ubin lembut; "Belum dikelompokkan" bernada amber (bukan masalah stok, perlu keputusan manual).
export const IKON_KELOMPOK = { BUSA: IkLapis, KAIN: IkGunting, BENANG: IkBenang, PEGAS: IkPegas, KAYU: IkKayu, LEM_KIMIA: IkTetes, AKSESORI: IkPerkakas, LAINNYA: IkKotak, BELUM: IkAwas };

export default function IkonBahan({ kode, ukuran = "md", className }) {
  const Ikon = IKON_KELOMPOK[kode] ?? IkTanya; const belum = kode === "BELUM";
  return (
    <span aria-hidden className={cn("gud-ikon-bahan", ukuran === "lg" && "gud-ikon-bahan-lg", belum && "gud-ikon-bahan-belum", className)} data-testid="ikon-bahan" data-kelompok={kode ?? ""}>
      <Ikon size={ukuran === "lg" ? 26 : 20} />
    </span>
  );
}
