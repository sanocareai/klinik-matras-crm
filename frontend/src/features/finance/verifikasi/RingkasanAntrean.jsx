import React from "react";
import { KpiKartu } from "@/features/finance/RingkasanPanels.jsx";
import { IkJam } from "@/features/finance/pemasukan/IkonPemasukan.jsx";
import { teksRp } from "@/features/finance/pemasukan/pemasukanLogic.js";
import { IkKlaimSales } from "./IkonVerifikasi.jsx";

// RINGKASAN ANTREAN — DUA antrean yang berbeda, ditampilkan terpisah dan TIDAK dijumlahkan:
//   1. Order yang ditandai lunas oleh Sales  : status di CRM, belum ada catatan pembayaran (belum ada uang masuk yang bisa diverifikasi).
//   2. Pembayaran menunggu verifikasi        : catatan pembayaran sudah ada, belum diperiksa Finance.
// Angka dari GET /finance/pemasukan/ringkasan (perluVerifikasiFinance) — sumber yang SAMA dengan kartu "Menunggu verifikasi" di Pemasukan, semua periode.
// Klaim lunas BERBUKTI (pengajuan Sales dengan bukti) dihitung server terpisah; dicatat di baris keterangan, tidak ditambahkan ke angka di atas.

const angka = (n) => Number(n ?? 0).toLocaleString("id-ID");

export default function RingkasanAntrean({ ringkasan, galat, onCoba, berbukti, ke }) {
  const v = ringkasan?.perluVerifikasiFinance;
  const memuat = !v && !galat;
  const nilaiKlaim = v ? `${angka(v.klaimSales.jumlah)} order` : memuat ? "Memuat…" : "Tidak tersedia";
  const nilaiBayar = v ? `${angka(v.pembayaranMenunggu.jumlah)} pembayaran` : memuat ? "Memuat…" : "Tidak tersedia";
  const adaBerbukti = berbukti && (berbukti.menunggu > 0 || berbukti.diminta > 0);

  return (
    <section aria-label="Ringkasan antrean" className="fin-vf-ringkasan" data-testid="ringkasan-antrean">
      <div className="fin-kpi-grid fin-vf-kpi-dua">
        <KpiKartu
          nada="lavender" Ikon={IkKlaimSales} label="Ditandai lunas oleh Sales" metrik="klaim_lunas_menunggu"
          nilai={nilaiKlaim}
          ket={v ? `${teksRp(v.klaimSales.nilai)} · semua periode · belum ada catatan pembayaran` : "Semua periode"}
          info="Status Lunas di CRM yang belum punya catatan uang masuk. Belum bisa diverifikasi sebagai pembayaran; Finance memeriksa uangnya lebih dulu."
          onClick={() => ke("lunas_crm")}
        />
        <KpiKartu
          nada="lime" Ikon={IkJam} label="Menunggu verifikasi" metrik="perlu_verifikasi_finance"
          nilai={nilaiBayar}
          ket={v ? `${teksRp(v.pembayaranMenunggu.nilai)} · semua periode · sudah tercatat, belum diperiksa` : "Semua periode"}
          info="Pembayaran yang sudah dicatat Sales atau driver, tetapi belum ada yang memastikan uangnya benar-benar masuk ke rekening atau kas perusahaan."
          onClick={() => ke("perlu")}
        />
      </div>
      <p className="fin-vf-ringkas-kaki" data-testid="ringkasan-terpisah">
        Dua antrean ini tidak dijumlahkan: yang pertama belum punya catatan pembayaran, yang kedua sudah.
        {adaBerbukti && <> Klaim lunas berbukti dari Sales dihitung terpisah: {angka(berbukti.menunggu)} menunggu verifikasi{berbukti.diminta > 0 ? `, ${angka(berbukti.diminta)} menunggu bukti tambahan` : ""}.</>}
      </p>
      {galat && (
        <p className="fin-galat" role="alert">Ringkasan antrean gagal dimuat: {galat} <button type="button" className="fin-pm-reset" onClick={onCoba}>Coba lagi</button></p>
      )}
    </section>
  );
}
