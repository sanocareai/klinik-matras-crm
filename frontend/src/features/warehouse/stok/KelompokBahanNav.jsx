import React from "react";
import { IKON_KELOMPOK } from "./IkonBahan.jsx";

// PILIHAN KELOMPOK BAHAN (Stok & Lokasi) — kontrol segmen ringkas dengan jumlah. Angka datang dari server (data.kelompok.total = bahan aktif per kelompok) dan kelompok berasal dari tabel eksplisit di server
// (itemGroup), TIDAK ditebak dari nama. "Belum dikelompokkan" tetap tampil (amber, bukan masalah stok) bila ada. Kelompok kosong tetap tampil dan jujur ("belum ada bahan").
export default function KelompokBahanNav({ kelompok = [], dipilih = "", onPilih, jumlahSemua, className }) {
  return (
    <nav aria-label="Kelompok bahan" className={className} data-testid="nav-kelompok">
      <ul className="gud-tab gud-tab-lipat gud-kelompok">
        <li>
          <button type="button" onClick={() => onPilih("")} aria-pressed={dipilih === ""} aria-selected={dipilih === ""} data-testid="kelompok-semua" className="max-sm:min-h-11">
            Semua <span className="gud-tab-jumlah">{jumlahSemua != null ? jumlahSemua : "—"}</span>
          </button>
        </li>
        {kelompok.map((k) => {
          const Ikon = IKON_KELOMPOK[k.kode]; const aktif = dipilih === k.kode; const kosong = k.total === 0 && k.nonaktif === 0; const peringatan = k.kode === "BELUM" && k.total > 0;
          const rincian = kosong ? "belum ada bahan" : `${k.diketahui} diketahui${k.minus > 0 ? ` · ${k.minus} minus` : ""}${k.belumDiketahui > 0 ? ` · ${k.belumDiketahui} belum diketahui` : ""}${k.nonaktif > 0 ? ` · ${k.nonaktif} nonaktif` : ""}`;
          return (
            <li key={k.kode}>
              <button type="button" onClick={() => onPilih(k.kode)} aria-pressed={aktif} aria-selected={aktif} data-testid={`kelompok-${k.kode}`} data-total={k.total} data-kosong={kosong ? "ya" : undefined} data-peringatan={peringatan ? "ya" : undefined} title={`${k.label}: ${rincian}`} className="max-sm:min-h-11">
                {peringatan && Ikon && <Ikon size={14} aria-hidden />}
                {k.label}
                <span className="gud-tab-jumlah" data-testid="kelompok-total">{k.total}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
