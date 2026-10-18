import React from "react";
import { AlertTriangle, Box, Boxes, Cable, Droplets, Layers, Scissors, Spline, TreePine, Wrench, LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils.js";

// NAVIGASI KELOMPOK BAHAN (Stok & Lokasi, UX Gudang Tahap 3) — kartu kelompok sebagai pintu masuk, bukan sekadar saringan. Angka datang dari server (data.kelompok): total (aktif), diketahui
// (punya catatan stok), minus, belum diketahui (BUKAN habis), dan nonaktif. Kelompok kosong tetap tampil jujur ("belum ada bahan"). "Belum dikelompokkan" = bahan yang itemGroup-nya tidak jelas
// atau kosong — butuh keputusan manual, TIDAK ditebak dari nama.
const IKON = { BUSA: Layers, KAIN: Scissors, BENANG: Spline, PEGAS: Cable, KAYU: TreePine, LEM_KIMIA: Droplets, AKSESORI: Wrench, LAINNYA: Box, BELUM: AlertTriangle };

export default function KelompokBahanNav({ kelompok = [], dipilih = "", onPilih, jumlahSemua, className }) {
  return (
    <nav aria-label="Kelompok bahan" className={className} data-testid="nav-kelompok">
      <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0 sm:grid-cols-3 lg:grid-cols-5">
        <li className="contents">
          <button type="button" onClick={() => onPilih("")} aria-pressed={dipilih === ""} data-testid="kelompok-semua"
            className={cn("flex min-h-[78px] flex-col justify-between rounded-btn border px-3 py-2.5 text-left transition-colors max-sm:min-h-[84px]", dipilih === "" ? "border-accent bg-accentbg" : "border-line bg-surface hover:bg-hovertint")}>
            <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink"><LayoutGrid size={14} aria-hidden /> Semua kelompok</span>
            <span className="text-[11px] text-ink3">{jumlahSemua != null ? `${jumlahSemua} bahan aktif` : "—"}</span>
          </button>
        </li>
        {kelompok.map((k) => {
          const Ikon = IKON[k.kode] ?? Boxes; const aktif = dipilih === k.kode; const kosong = k.total === 0 && k.nonaktif === 0; const peringatan = k.kode === "BELUM" && k.total > 0;
          return (
            <li key={k.kode} className="contents">
              <button type="button" onClick={() => onPilih(k.kode)} aria-pressed={aktif} data-testid={`kelompok-${k.kode}`} data-total={k.total}
                className={cn("flex min-h-[78px] flex-col justify-between rounded-btn border px-3 py-2.5 text-left transition-colors max-sm:min-h-[84px]", aktif ? "border-accent bg-accentbg" : peringatan ? "border-orange bg-orangebg/40 hover:bg-orangebg/70" : "border-line bg-surface hover:bg-hovertint", kosong && !aktif && "opacity-70")}>
                <span className="flex items-center justify-between gap-1">
                  <span className={cn("flex items-center gap-1.5 text-[12.5px] font-semibold", peringatan ? "text-orange" : "text-ink")}><Ikon size={14} aria-hidden /> {k.label}</span>
                  <span className="text-[18px] font-bold tabular-nums leading-none text-ink" data-testid="kelompok-total">{k.total}</span>
                </span>
                <span className="mt-1 block text-[11px] leading-snug text-ink3" data-testid="kelompok-rincian">
                  {kosong ? "belum ada bahan" : <>
                    {k.diketahui} diketahui
                    {k.minus > 0 && <> · <span className="font-semibold text-red">{k.minus} minus</span></>}
                    {k.belumDiketahui > 0 && <> · {k.belumDiketahui} belum diketahui</>}
                    {k.nonaktif > 0 && <> · {k.nonaktif} nonaktif</>}
                  </>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
