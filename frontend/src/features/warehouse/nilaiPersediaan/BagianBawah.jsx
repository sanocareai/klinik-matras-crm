import React, { forwardRef } from "react";
import { TEKS_NILAI_PARSIAL, teksRupiah, teksSaldo } from "./nilaiPersediaanLogic.js";
import { topengNominal } from "./nilaiTampilanLogic.js";

// Dua bagian terlipat di bawah tabel: "Rincian akun Finance" (bukti & penyebab belum direkonsiliasi; dibuka juga lewat tombol Rincian akun di kartu) dan "Definisi dan sumber angka".
// Isi tidak berubah dari versi sebelumnya (angka dan kalimat dari server); hanya dipindah ke bagian terlipat agar halaman utama tidak berupa paragraf.
export const RincianFinance = forwardRef(function RincianFinance({ d, nominal }, ref) {
  const b = d.finance.bukti;
  return (
    <details className="nip-bagian" ref={ref} data-testid="np-bukti">
      <summary><span className="nip-bagian-judul">Rincian akun Finance</span><span className="nip-bagian-info">{b.berbukti} berbukti · {b.sebagian} sebagian · {b.tanpaBukti} tanpa bukti</span></summary>
      <div className="nip-bagian-isi nip-bukti">
        <p className="nip-kecil">{topengNominal(b.catatan, nominal)} Saldo akun <b>tidak</b> dibagi ke bahan; tabel ini hanya menunjukkan ada/tidaknya bukti biaya perolehan dari penerimaan berharga.</p>
        <h4>Penyebab belum direkonsiliasi</h4><ul data-testid="np-alasan">{d.finance.alasan.map((a) => <li key={a}>{topengNominal(a, nominal)}</li>)}</ul>
        <h4>Nilai parsial berdasarkan biaya penerimaan terakhir</h4>
        <p className="nip-kecil" data-testid="np-parsial">{nominal ? <b>{teksRupiah(d.finance.nilaiParsial.nilai)}</b> : "—"} untuk {d.finance.nilaiParsial.bahanDenganBiaya} bahan aktif yang pernah punya biaya penerimaan ({d.finance.nilaiParsial.bahanTanpaBiaya} tidak){nominal ? `; bagian saldo minus ${teksRupiah(d.finance.nilaiParsial.bagianSaldoMinus)}` : ""}. {TEKS_NILAI_PARSIAL}</p>
        <h4>Saldo akun per sumber jurnal</h4>
        {d.finance.perSumber.length === 0 ? <p className="nip-kecil">Belum ada jurnal pada akun ini.</p> : (
          <div className="nip-gulir nip-gulir-pendek"><table className="nip-tabel nip-tabel-kecil"><thead><tr><th>Sumber</th><th className="nip-n">Jurnal</th><th>Periode</th>{nominal && <th className="nip-n">Debit</th>}{nominal && <th className="nip-n">Kredit</th>}</tr></thead>
            <tbody>{d.finance.perSumber.map((s) => <tr key={s.sumber}><td>{s.sumber}</td><td className="nip-n">{s.jurnal}</td><td>{s.awal} – {s.akhir}</td>{nominal && <td className="nip-n">{teksRupiah(s.debit)}</td>}{nominal && <td className="nip-n">{teksRupiah(s.kredit)}</td>}</tr>)}</tbody></table></div>
        )}
        {d.finance.persediaanAwal && <p className="nip-kecil">Persediaan Awal {d.finance.persediaanAwal.nomor}: <b>{d.finance.persediaanAwal.status}</b> (cutover {d.finance.persediaanAwal.cutover}).</p>}
        {nominal && d.finance.pembandingLedger && <p className="nip-kecil">Pembanding: jumlah biaya penerimaan berharga di ledger stok {teksRupiah(d.finance.pembandingLedger.totalBiayaPenerimaanBerharga)}; selisih dengan saldo akun {teksRupiah(d.finance.pembandingLedger.selisihDenganSaldoAkun)}.</p>}
        <h4>Bukti harga per bahan (bahan bersaldo)</h4>
        <div className="nip-gulir nip-gulir-pendek"><table className="nip-tabel nip-tabel-kecil" data-testid="np-bukti-tabel"><thead><tr><th>Bahan</th><th className="nip-n">Saldo</th><th className="nip-n">Qty berbukti</th><th className="nip-n">Qty tanpa bukti</th><th className="nip-n">GR</th>{nominal && <th className="nip-n">Biaya rata-rata</th>}{nominal && <th className="nip-n">Harga Berlaku*</th>}</tr></thead>
          <tbody>{b.rincian.slice(0, 400).map((r) => <tr key={r.materialId}><td><div className="nip-nama">{r.nama}</div><div className="nip-kode">{r.kode}</div></td><td className="nip-n">{teksSaldo(r.saldo, r.satuan)}</td><td className="nip-n">{teksSaldo(r.qtyBerbukti, r.satuan)}</td><td className="nip-n">{r.qtyTanpaBukti > 0 ? <span className="nip-chip">{teksSaldo(r.qtyTanpaBukti, r.satuan)}</span> : "—"}</td><td className="nip-n">{r.jumlahGR}</td>{nominal && <td className="nip-n">{r.biayaRata2 === null ? "tidak ada" : teksRupiah(r.biayaRata2)}</td>}{nominal && <td className="nip-n">{r.hargaBerlaku === null ? "—" : teksRupiah(r.hargaBerlaku)}</td>}</tr>)}</tbody></table></div>
        {nominal && <p className="nip-kecil">*Harga Berlaku adalah harga kerja Gudang, <b>bukan</b> bukti perolehan Finance.</p>}
      </div>
    </details>
  );
});

export function DefinisiNilai({ d }) {
  return (
    <details className="nip-bagian" data-testid="np-definisi">
      <summary><span className="nip-bagian-judul">Definisi dan sumber angka</span></summary>
      <div className="nip-bagian-isi">
        <ul className="nip-def">
          <li><b>Estimasi nilai stok.</b> {d.definisi.estimasi}</li><li><b>Berdasarkan ledger.</b> {d.definisi.ledger}</li><li><b>Tanpa hasil SO bermasalah.</b> {d.definisi.tanpaBermasalah}</li><li><b>Hasil SO.</b> {d.definisi.hasilSO}</li>
          <li data-testid="np-izin-nominal"><b>Siapa melihat nominal.</b> {d.izin.keterangan} Peran: {d.izin.peranPelihatNominal.join(", ")}.</li>
          <li><b>Saldo akun Finance.</b> {d.definisi.finance}</li><li><b>Bahan relevan.</b> {d.definisi.relevan}</li><li><b>Waktu acuan.</b> {d.definisi.waktu}</li>
        </ul>
      </div>
    </details>
  );
}
