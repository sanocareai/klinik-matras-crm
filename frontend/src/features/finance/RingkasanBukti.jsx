import React, { useId, useState } from "react";
import { Button } from "@/components/ui/button.jsx";
import { Uang, SelBukti, tanggalPendek } from "@/features/finance/shared.jsx";
import { BUKTI_AWAL, potongBukti } from "@/features/finance/ringkasanTampilan.js";
import { angkaId } from "@/features/finance/RingkasanKecil.jsx";

// "Bukti transaksi perlu diperiksa": ditutup secara default (dibuka lewat "Lihat bukti"); lima entri awal, lalu SEMUA hasil yang dimuat dengan halaman. "Hasil" = yang terdeteksi dari maksimal 200 pengeluaran + 200 pembelian terbaru, bukan seluruh database. Data = respons /finance/bukti-review (tidak ada perubahan backend).
// Memeriksa/memverifikasi tetap lewat SelBukti (aksi manual pengguna; tidak ada verifikasi otomatis). Aturan "verifikator ≠ pembuat" ditegakkan server.
export default function BuktiDaftar({ bukti, galat, aksi }) {
  const [mode, setMode] = useState("awal");
  const [halaman, setHalaman] = useState(0);
  const idDaftar = useId();
  const potong = potongBukti(bukti.items, mode, halaman);
  return (
    <div className="fin-bk" data-testid="bukti-daftar">
      {galat && <p className="fin-galat" role="alert">{galat}</p>}
      <div className="fin-bk-kepala" aria-hidden="true">
        <span>Keterangan</span><span>Tanggal</span><span>Pencatat</span><span className="fin-kanan">Nominal</span><span>Status dan tindakan</span>
      </div>
      <ul id={idDaftar} className="fin-bk-daftar" aria-label="Bukti transaksi perlu diperiksa">
        {potong.baris.map((i) => (
          <li key={`${i.jenis}-${i.id}`} className="fin-bk-item">
            <div className="fin-bk-utama">
              <span className="fin-bk-nomor">{i.nomor}</span>
              <span className="fin-bk-ket" title={i.description}>{i.description}</span>
            </div>
            <span className="fin-bk-tgl">{tanggalPendek(i.date)}</span>
            <span className="fin-bk-oleh">{i.createdBy?.name || "—"}</span>
            <span className="fin-bk-nominal"><Uang value={i.amount} /></span>
            <span className="fin-bk-status">
              <span className={`fin-chip ${i.masalah === "TANPA_NOTA" ? "fin-chip-red" : "fin-chip-perhatian"}`}>{i.masalah === "TANPA_NOTA" ? "Tanpa nota" : "Belum diverifikasi"}</span>
              <SelBukti doc={{ id: i.id, status: i.status, receiptUrl: i.receiptUrl }} jenis={i.jenis} aksi={aksi} />
            </span>
          </li>
        ))}
      </ul>
      <div className="fin-bk-kaki">
        {mode === "awal" ? (
          potong.adaLagi
            ? <Button variant="tertiary" size="sm" className="fin-panel-tautan" aria-controls={idDaftar} onClick={() => { setMode("semua"); setHalaman(0); }}>Lihat {angkaId(potong.total)} hasil</Button>
            : <span className="fin-redup">Menampilkan {angkaId(potong.total)} hasil.</span>
        ) : (
          <>
            <span className="fin-redup" aria-live="polite">Halaman {potong.halaman + 1} dari {potong.jumlahHalaman} · {angkaId(potong.total)} hasil</span>
            <span className="fin-bk-nav">
              <Button variant="tertiary" size="sm" disabled={potong.halaman === 0} onClick={() => setHalaman(potong.halaman - 1)}>Sebelumnya</Button>
              <Button variant="tertiary" size="sm" disabled={potong.halaman >= potong.jumlahHalaman - 1} onClick={() => setHalaman(potong.halaman + 1)}>Berikutnya</Button>
              <Button variant="tertiary" size="sm" onClick={() => { setMode("awal"); setHalaman(0); }}>Tampilkan {BUKTI_AWAL} awal saja</Button>
            </span>
          </>
        )}
      </div>
    </div>
  );
}
