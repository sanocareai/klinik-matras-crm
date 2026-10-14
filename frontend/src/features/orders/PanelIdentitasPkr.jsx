import React from "react";
import { modelSumberPkr, barisSumberPkr } from "@/features/orders/pkrSumberModel.js";

// PANEL IDENTITAS Penjualan Karyawan — blok TERSTRUKTUR di bagian diperluas (bukan tooltip/dropdown di sel sempit yang menimpa foto/nama customer).
// Satu kali per order; data sama dengan model sumber (nomor PKR, karyawan penjual, customer/pembeli, penerima, item & unit, status pembayaran).
export default function PanelIdentitasPkr({ pkr, className = "" }) {
  const m = modelSumberPkr(pkr);
  if (!m) return null;
  const baris = barisSumberPkr(m);
  return (
    <section className={`rounded-btn border border-line bg-surface px-3 py-2 ${className}`} aria-label="Identitas Penjualan Karyawan" data-testid="panel-identitas-pkr">
      <p className="m-0 mb-1.5 text-[10.5px] font-bold uppercase tracking-wide text-ink3">Identitas Penjualan Karyawan</p>
      <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
        {baris.map(([label, nilai]) => (
          <div key={label} className="min-w-0">
            <dt className="text-[10.5px] text-ink3">{label}</dt>
            <dd className="m-0 break-words text-[12.5px] font-semibold text-ink">{nilai}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
