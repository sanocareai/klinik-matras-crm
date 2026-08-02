import React from "react";
import { cn } from "@/lib/utils.js";

// Penanda "Contoh" untuk widget yang isinya data dummy.
//
// Ini BUKAN hiasan. Konvensinya sudah berlaku di repo ini sejak Wave 2A
// (features/dashboard/data/contracts.js): "Widget yang memakai mock WAJIB
// menandainya sebagai 'Contoh' di UI (jujur — bukan data asli)."
//
// Alasannya spesifik untuk modul ini: halaman Delivery dibuka oleh orang yang
// SAMA yang memakai /armada dengan data operasional ASLI. Tanpa penanda,
// angka contoh di sini akan terbaca sebagai kondisi lapangan sungguhan dan
// dipakai mengambil keputusan penjadwalan.
export default function MockBadge({ className }) {
  return (
    <span
      title="Angka pada widget ini masih data contoh, bukan data operasional asli."
      className={cn(
        "inline-flex shrink-0 items-center rounded-chip bg-orangebg px-1.5 py-0.5",
        "text-[9px] font-bold uppercase tracking-wide text-orange",
        className
      )}
    >
      Contoh
    </span>
  );
}
