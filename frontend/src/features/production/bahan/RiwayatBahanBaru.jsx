import React, { useState } from "react";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import { cn } from "@/lib/utils.js";
import { formatJumlah, waktuWib } from "@/features/production/orderProduksiModel.js";
import { tglIndo } from "@/features/production/bahan/pembetulanModel.js";

// Riwayat pemakaian BAHAN BARU (ledger resmi): siapa, kapan, bahan, jumlah, satuan, dokumen sumber, dampak pada stok, dan (untuk perubahan/pembetulan) tanggal pemakaian yang dilaporkan + dasar harga HPP.
// Hanya BACA. Mengubah jumlah atau mengganti bahan = tombol "Edit" pada tabel Pemakaian aktual; baris di sini tidak pernah diedit/dihapus (perubahan = baris baru).
export default function RiwayatBahanBaru({ data }) {
  const baris = data.pemakaianAktual?.baris ?? [];
  const [semua, setSemua] = useState(false);
  if (!baris.length) return null;
  const tampil = semua ? baris : baris.slice(0, 6);
  return (
    <div className="space-y-2" data-testid="riwayat-bahan-baru">
      <ul className="m-0 list-none divide-y divide-line rounded-btn bg-inset p-0" data-testid="aktual-baris">
        {tampil.map((b) => {
          const balik = b.tipe === "RETURN";
          return (
            <li key={b.id} className="space-y-1 px-3 py-2 text-[12.5px]" data-testid="aktual-riwayat-baris">
              <div className="flex items-baseline gap-2"><span className="min-w-0 flex-1 truncate font-medium text-ink">{b.nama}</span><span className={cn("shrink-0 font-semibold tabular-nums", balik ? "text-green" : "text-ink")}>{balik ? "−" : ""}{formatJumlah(Math.abs(b.qty))} {b.satuan}</span></div>
              <div className="text-ink3">{b.pelaku || "—"} · {b.dilaporkan ? "dicatat " : ""}{waktuWib(b.tanggal)}{b.dilaporkan ? <> · <b className="text-ink2" data-testid="aktual-dilaporkan">dilaporkan dipakai {tglIndo(b.dilaporkan)}</b></> : null} · {b.dokumen.jenis}{b.dokumen.nomor ? ` ${b.dokumen.nomor}` : ""}</div>
              {b.hppOperasional && <div className="text-ink3" data-testid="aktual-hpp-dasar">HPP operasional: {b.hppOperasional.status === "DINILAI" ? (b.hppOperasional.harga == null ? `ada harga pada ${tglIndo(b.hppOperasional.tanggalDasar)} (angka hanya untuk peran berizin)` : `harga ${formatJumlah(b.hppOperasional.harga)} per ${b.satuan} (${b.hppOperasional.dasarTeks})`) : b.hppOperasional.status === "TANPA_HARGA" ? `TANPA_HARGA / belum diketahui — belum ada harga pada ${tglIndo(b.hppOperasional.tanggalDasar)}` : b.hppOperasional.dasarTeks}</div>}
              <div className="flex flex-wrap items-center gap-1.5"><Badge variant={balik ? "green" : "orange"} className={balik ? "bh-ok" : "bh-b-orange"}>{balik ? "Menambah stok (koreksi)" : "Mengurangi stok"}</Badge>{b.catatan && <span className="text-ink3">{b.catatan}</span>}</div>
            </li>
          );
        })}
      </ul>
      {baris.length > 6 && <Button variant="tertiary" size="sm" className="min-h-[40px]" onClick={() => setSemua((v) => !v)}>{semua ? "Tampilkan lebih sedikit" : `Tampilkan semua (${baris.length})`}</Button>}
    </div>
  );
}
