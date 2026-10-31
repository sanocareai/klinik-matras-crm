import React, { useState } from "react";
import { AlertTriangle, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils.js";

// Peringatan Laporan dalam bentuk ringkas: JUDUL + jumlah/masalah + tombol "Lihat rincian".
// Penjelasan lengkap (teks panjang aslinya) tidak dibuang — dibuka lewat tombol, jadi peringatan penting tetap
// terlihat sekilas tanpa memenuhi layar. `tone`: "merah" (data hilang/salah) | "oranye" (perlu diperiksa).
// Hanya styling di .crm-lap (styles/sanss-crm-laporan.css).
// `aksi` (opsional) = { teks, onClick }: tombol di kanan yang membuka rincian di tempat lain (mis. panel Kualitas data) — alternatif dari `children`.
export default function AlertRingkas({ tone = "oranye", judul, ringkas, children, bukaAwal = false, testid, aksi = null }) {
  const [buka, setBuka] = useState(bukaAwal);
  return (
    <div className="crm-lap-alert" data-tone={tone} data-testid={testid} role="alert">
      <div className="crm-lap-alert-baris">
        <span className="crm-lap-alert-ikon" aria-hidden="true"><AlertTriangle size={18} /></span>
        <p className="crm-lap-alert-teks">
          <strong>{judul}</strong>
          {ringkas && <span className="crm-lap-alert-titik"> · </span>}
          {ringkas && <span>{ringkas}</span>}
        </p>
        {children && (
          <button type="button" className="crm-lap-alert-aksi" aria-expanded={buka} onClick={() => setBuka((v) => !v)}>
            {buka ? "Tutup rincian" : "Lihat rincian"}
            <ChevronDown size={14} className={cn("transition-transform", buka && "rotate-180")} aria-hidden="true" />
          </button>
        )}
        {aksi && !children && <button type="button" className="crm-lap-alert-aksi" onClick={aksi.onClick}>{aksi.teks}<ChevronDown size={14} aria-hidden="true" /></button>}
      </div>
      {children && buka && <div className="crm-lap-alert-rincian">{children}</div>}
    </div>
  );
}
