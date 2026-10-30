import React from "react";
import { cn } from "@/lib/utils.js";
import { IKON_KELOMPOK } from "./IkonBahan.jsx";

// PILIHAN KELOMPOK BAHAN (Stok & Lokasi) — kontrol segmen ringkas dengan jumlah, bukan kartu besar penuh teks. Angka datang dari server (data.kelompok.total = bahan aktif per kelompok) dan kelompok
// berasal dari tabel eksplisit di server (itemGroup), TIDAK ditebak dari nama. "Belum dikelompokkan" tetap tampil (amber) bila ada. Kelompok kosong tetap tampil dan jujur ("belum ada bahan").
export default function KelompokBahanNav({ kelompok = [], dipilih = "", onPilih, jumlahSemua, className }) {
  const butir = "inline-flex shrink-0 whitespace-nowrap min-h-11 items-center gap-1.5 rounded-xl px-3 text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/50 sm:min-h-9";
  return (
    <nav aria-label="Kelompok bahan" className={className} data-testid="nav-kelompok">
      <ul className="m-0 flex list-none flex-nowrap gap-1 overflow-x-auto rounded-2xl bg-inset p-1 sm:flex-wrap sm:overflow-visible [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <li>
          <button type="button" onClick={() => onPilih("")} aria-pressed={dipilih === ""} data-testid="kelompok-semua"
            className={cn(butir, dipilih === "" ? "bg-surface font-semibold text-ink shadow-card" : "stok-t2 hover:bg-hovertint")}>
            Semua <span className="text-[11.5px] tabular-nums stok-t2">{jumlahSemua != null ? jumlahSemua : "—"}</span>
          </button>
        </li>
        {kelompok.map((k) => {
          const Ikon = IKON_KELOMPOK[k.kode]; const aktif = dipilih === k.kode; const kosong = k.total === 0 && k.nonaktif === 0; const peringatan = k.kode === "BELUM" && k.total > 0;
          const rincian = kosong ? "belum ada bahan" : `${k.diketahui} diketahui${k.minus > 0 ? ` · ${k.minus} minus` : ""}${k.belumDiketahui > 0 ? ` · ${k.belumDiketahui} belum diketahui` : ""}${k.nonaktif > 0 ? ` · ${k.nonaktif} nonaktif` : ""}`;
          return (
            <li key={k.kode}>
              <button type="button" onClick={() => onPilih(k.kode)} aria-pressed={aktif} data-testid={`kelompok-${k.kode}`} data-total={k.total} title={`${k.label}: ${rincian}`}
                className={cn(butir, aktif ? "bg-surface font-semibold text-ink shadow-card" : peringatan ? "text-orange hover:bg-hovertint" : "stok-t2 hover:bg-hovertint", kosong && !aktif && "opacity-60")}>
                {peringatan && Ikon && <Ikon size={13} aria-hidden />}
                {k.label}
                <span className={cn("text-[11.5px] tabular-nums", peringatan ? "text-orange" : "stok-t2")} data-testid="kelompok-total">{k.total}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
