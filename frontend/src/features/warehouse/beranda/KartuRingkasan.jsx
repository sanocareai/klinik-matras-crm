import React from "react";
import { Glif, Ubin } from "./IkonApple.jsx";

// Empat kartu ringkasan antrean bergaya widget iOS (biru · langit · ungu · oranye-koral). Angka = jumlah DOKUMEN dari server (bukan jumlah baris yang dimuat). Kartu dapat tumpang tindih
// (dokumen yang lewat jadwal juga masih ada di kartu tahapnya), jadi tidak dijumlahkan menjadi "total pekerjaan". Warna hanyalah identitas kartu, bukan penilaian aman/tidak
// (kartu terlambat/tertahan sengaja hangat, bukan hijau). Mengetuk kartu menyaring daftar di bawahnya; kartu yang sedang jadi saringan ditandai aria-pressed.
const GLIF = { kedatangan: "truk", periksa: "dokumen", siap: "kotak", tertahan: "awas" };

export default function KartuRingkasan({ kartu, aktif, onPilih }) {
  return (
    <section aria-label="Ringkasan antrean" className="gud-br-kartu-baris" data-testid="ringkasan-beranda">
      {kartu.map((k) => {
        const dipilih = aktif === k.kode;
        return (
          <button key={k.kode} type="button" className={`gud-br-kartu gud-br-kartu-${k.nada}`} aria-pressed={dipilih} onClick={() => onPilih(k)} data-testid={`kartu-${k.kode}`}
            aria-label={`${k.label}: ${k.nilai} ${k.satuan}${k.ket ? `. ${k.ket}` : ""}. Ketuk untuk menyaring daftar.`}>
            <Glif nama={GLIF[k.kode]} size={96} className="gud-br-kartu-besar" />
            <span className="gud-br-kartu-atas"><Ubin nada="kaca" nama={GLIF[k.kode]} ukuran={36} /><span className="gud-br-kartu-label">{k.label}</span></span>
            <span className="gud-br-kartu-nilai"><span className="gud-br-angka" data-testid={`angka-${k.kode}`}>{k.nilai.toLocaleString("id-ID")}</span><span className="gud-br-satuan">{k.satuan}</span></span>
            {k.ket && <span className={`gud-br-kartu-ket${k.kode === "tertahan" ? "" : " gud-br-kartu-ket-peringatan"}`} data-testid={`ket-${k.kode}`}>{k.ket}</span>}
          </button>
        );
      })}
    </section>
  );
}
