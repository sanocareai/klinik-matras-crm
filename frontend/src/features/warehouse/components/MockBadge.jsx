import React from "react";
import { cn } from "@/lib/utils.js";

// Penanda "Contoh" untuk widget berisi data dummy.
//
// Konvensi repo sejak Wave 2A (features/dashboard/data/contracts.js): "Widget
// yang memakai mock WAJIB menandainya sebagai 'Contoh' di UI (jujur — bukan
// data asli)." Dipakai konsisten di seluruh modul Delivery.
//
// Alasan spesifik untuk Warehouse: halaman lama pages/Gudang.jsx menampilkan
// saldo stok ASLI dari ledger. Orang yang sama membuka kedua halaman. Tanpa
// penanda, angka contoh di sini akan terbaca sebagai stok sungguhan dan
// dipakai memutuskan pembelian.
export default function MockBadge({ className }) {
  return (
    <span
      title="Angka pada widget ini masih data contoh, bukan stok operasional asli."
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
