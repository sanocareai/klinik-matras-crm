import React from "react";
import LaporanDivisi from "@/features/laporanDivisi/LaporanDivisi.jsx";

// Halaman laporan biaya di workspace sebuah divisi: komponen yang SAMA dengan Finance, dikunci ke satu divisi (scopeTetap).
// Izin sebenarnya ditegakkan server (/api/laporan-divisi) — halaman ini hanya menampilkan apa yang diizinkan.
export default function LaporanBiayaDivisi({ scope, judul }) {
  return <LaporanDivisi scopeTetap={scope} judul={judul} />;
}
