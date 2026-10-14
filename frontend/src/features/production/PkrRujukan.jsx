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
      {t.pembeli && <span data-testid="pkr-pembeli" className="min-w-0 truncate text-[12px] font-semibold text-ink">{t.pembeli}</span>}
      {t.karyawan && <span data-testid="pkr-karyawan" className="min-w-0 truncate text-[12px] text-ink2">Dijual oleh {t.karyawan}</span>}
      {t.legacy && <Badge variant="orange" data-testid="pkr-data-customer-belum-lengkap">Data customer belum lengkap</Badge>}
      <Badge variant="neutral" data-testid="pkr-kirim">{t.kirim}</Badge>
      {t.perluDilengkapi && <Badge variant="orange" data-testid="pkr-perlu-dilengkapi">Perlu dilengkapi</Badge>}
      {rinci && t.items?.length > 0 && (
        <ul className="m-0 basis-full list-none space-y-0.5 p-0 text-[12px] text-ink2" data-testid="pkr-item">
          {t.items.map((i) => (
            <li key={i.no}>Item {i.no}: <span className="text-ink">{i.teks}</span>{i.ukuran ? ` · ${i.ukuran}` : ""} · {i.kirim}{i.kurang ? <span className="text-orange"> — kurang: {i.kurang}</span> : null}</li>
          ))}
        </ul>
      )}
      {rinci && t.perluDilengkapi && t.kurangTeks && <span data-testid="pkr-kurang" className="basis-full text-[12px] text-orange">Data yang kurang: {t.kurangTeks}. Lengkapi di Finance › Penjualan Karyawan.</span>}
    </span>
  );
}
