import React from "react";
import { Badge } from "@/components/ui/badge.jsx";
import { tampilRujukanPkr } from "@/features/production/pkrRujukanModel.js";

// Rujukan order Penjualan Karyawan di kartu/baris/detail Produksi. Dihitung server dari ORDER (bukan dari Run), jadi tampil walau flag V2 mati. Tanpa nominal.
// `rinci`: tampilkan juga daftar data yang kurang (detail Unit 360); kartu ringkas cukup lencana "Perlu dilengkapi" (rinciannya ada di pesan Rencana).
export default function PkrRujukan({ pkr, rinci = false, className = "" }) {
  const t = tampilRujukanPkr(pkr);
  if (!t) return null;
  return (
    <span data-testid="pkr-rujukan" data-pkr-nomor={t.nomor} className={`flex min-w-0 flex-wrap items-center gap-1.5 ${className}`}>
      <Badge variant="accent" data-testid="pkr-badge">{t.badge}</Badge>
      <span data-testid="pkr-nomor" className="font-mono text-[11.5px] font-semibold text-ink2">{t.nomor}</span>
      {t.karyawan && <span data-testid="pkr-karyawan" className="min-w-0 truncate text-[12px] text-ink2">{t.karyawan}</span>}
      <Badge variant="neutral" data-testid="pkr-kirim">{t.kirim}</Badge>
      {t.perluDilengkapi && <Badge variant="orange" data-testid="pkr-perlu-dilengkapi">Perlu dilengkapi</Badge>}
      {rinci && t.perluDilengkapi && t.kurangTeks && <span data-testid="pkr-kurang" className="basis-full text-[12px] text-orange">Data yang kurang: {t.kurangTeks}. Lengkapi di Finance › Penjualan Karyawan.</span>}
    </span>
  );
}
