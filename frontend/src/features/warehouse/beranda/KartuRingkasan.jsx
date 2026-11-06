import React from "react";
import { IkTruk, IkDokumen, IkKotak, IkAwas } from "@/components/gudangIcons.jsx";

// Empat kartu ringkasan antrean (palet biru elektrik · biru muda · lavender · lime lembut). Angka = jumlah DOKUMEN dari server (bukan jumlah baris yang dimuat). Kartu dapat tumpang tindih
// (dokumen yang lewat jadwal juga masih ada di kartu tahapnya), jadi tidak dijumlahkan menjadi "total pekerjaan". Warna hanyalah identitas kartu, bukan penilaian aman/tidak.
// Mengetuk kartu menyaring daftar di bawahnya; kartu yang sedang jadi saringan ditandai aria-pressed.
const IKON = { kedatangan: IkTruk, periksa: IkDokumen, siap: IkKotak, tertahan: IkAwas };

export default function KartuRingkasan({ kartu, aktif, onPilih }) {
  return (
    <section aria-label="Ringkasan antrean" className="gud-br-kartu-baris" data-testid="ringkasan-beranda">
      {kartu.map((k) => {
        const Ikon = IKON[k.kode]; const dipilih = aktif === k.kode;
        return (
          <button key={k.kode} type="button" className={`gud-br-kartu gud-br-kartu-${k.nada}`} aria-pressed={dipilih} onClick={() => onPilih(k)} data-testid={`kartu-${k.kode}`}
            aria-label={`${k.label}: ${k.nilai} ${k.satuan}${k.ket ? `. ${k.ket}` : ""}. Ketuk untuk menyaring daftar.`}>
            <span className="gud-br-kartu-atas"><span className="gud-br-ubin" aria-hidden="true"><Ikon size={22} /></span><span className="gud-br-kartu-label">{k.label}</span></span>
            <span className="gud-br-kartu-nilai"><span className="gud-br-angka" data-testid={`angka-${k.kode}`}>{k.nilai.toLocaleString("id-ID")}</span><span className="gud-br-satuan">{k.satuan}</span></span>
            {k.ket && <span className={`gud-br-kartu-ket${k.kode === "tertahan" ? "" : " gud-br-kartu-ket-peringatan"}`} data-testid={`ket-${k.kode}`}>{k.ket}</span>}
          </button>
        );
      })}
    </section>
  );
}
