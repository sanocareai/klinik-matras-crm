# Audit tanda laporan Finance — 23 Oktober 2026

Cabang: `fix/finance-tanda-laporan-pembalik-beban` (dari baseline live `1f79ddd2`). Status: **kandidat, belum merge, belum deploy.**

## Ringkasan

Angka di backend sudah benar: akun biaya dilaporkan sebagai biaya **neto** (debit − kredit) dan rumus laba utuh
(`Laba Bersih = Pendapatan Bersih − Beban Pokok − Beban Operasional`). Yang salah adalah **penyajian**:

| # | Temuan audit | Penyebab | Perbaikan |
|---|---|---|---|
| P1 | Akun biaya bersaldo kredit bersih tampil sebagai angka positif tanpa keterangan | Frontend membalik tanda (`-row.nilai`) untuk semua beban; dashboard `-(lr.bebanPokok)`; Excel tanpa label | Satu sumber teks di backend (`penandaBiaya.js`) → "Pembalik beban bersih", nominal dalam kurung, penjelasan "mengurangi biaya dan menaikkan laba" di Laba Rugi, dashboard, rincian HPP, Beban per Divisi, drilldown, grafik, Laporan Divisi, dan semua Excel terkait |
| P2 | Neraca Saldo menaruh saldo terbalik sebagai angka negatif di sisi normalnya | `saldoDebit/saldoKredit` mengikuti saldo normal | Saldo terbalik di sisi yang benar dengan angka positif + penanda "Saldo terbalik" (`sisiSaldo`, `saldoTidakNormal`) |
| P2 | Pesan Neraca tidak seimbang menebak satu penyebab | Teks tetap | Melaporkan selisih + empat langkah pemeriksaan, tanpa klaim penyebab |
| P2 | Filter drilldown hanya menyaring baris yang sudah dikirim (maks 8000) | Penyaringan di klien | Filter dikirim ke server; `jumlah`, `totalTersaring`, `jumlahSemua` dihitung dari SEMUA baris; bila daftar dipotong layar menyebut "parsial" |
| P2 | Pembacaan laporan terinci tidak READ ONLY | Transaksi biasa | `SET TRANSACTION READ ONLY` sebagai pernyataan pertama (database menolak tulisan, SQLSTATE 25006) |
| P1 | Mutu margin belum final | 254 ISSUE historis tanpa nilai; reklas lintas bulan | **Tidak diubah** — lihat "Keputusan terbuka" |

Tanda jurnal, nilai `nilai` per akun, dan rumus laba **tidak diubah** demi tampilan.

## Yang diubah

Backend: `services/finance/penandaBiaya.js` (baru), `reports.js` (`neracaSaldo`, `labaRugi`), `laporanTerinci/{index,hpp,bebanDivisi}.js`,
`export/laporan-keuangan.js`, `laporanDivisi/export.js`, `routes/finance.js` (penanda di ringkasan dashboard).
Kontrol parity baru: Σ akun beban pokok dan Σ akun beban operasional = kartu.

Frontend: `features/finance/biayaNeto.jsx` + `biayaNetoLogic.js` (baru), `pages/finance/FinanceReports.jsx`, `FinanceDashboard.jsx`,
`laporanTerinci/{PanelHppBeban,DrilldownKartu}.jsx`, `features/laporanDivisi/LaporanDivisi.jsx`.
Nominal pembalik berwarna hijau (menaikkan laba), bukan merah seperti saldo negatif biasa.

## Bukti

**Tes integrasi (DB terisolasi)** `laporanTandaPembalik.integration.test.js`, 8 skenario lulus: pembalik overhead lintas bulan; beban operasional kredit bersih;
retur dibalik (akun kontra); Neraca Saldo sisi benar; Neraca & Arus Kas konsisten; periode kosong; data tanpa harga (bukan biaya Rp0, margin tidak final);
beban per divisi (residual Rp0); drilldown server-side + parsial; READ ONLY (tulisan ditolak). Kartu = Σ akun = Σ jurnal = Excel sampai sen.

**Tes unit**: `backend/tests/penandaBiaya.test.js` (5), `frontend/tests/biayaNetoPembalik.test.js` (8).

**QA UI** (Chrome headless, DB terisolasi): desktop 1440 dan HP 390, terang dan gelap. Tanpa scroll horizontal. Dua cacat ditemukan dan diperbaiki sebelum commit:
penanda "Saldo terbalik" terpotong pada nama akun panjang; label pembalik menyebabkan baris Beban per Divisi meluap di HP.

**Produksi, baca-saja** (transaksi `REPEATABLE READ READ ONLY`, di-ROLLBACK; snapshot 23 Okt 2026 12:57 WIB; tidak ada jurnal/transaksi QA):

- Σ debit = Σ kredit seluruh buku: Rp8.018.646.224,63, selisih Rp0,00.
- Neraca Saldo kumulatif: total saldo debit = total saldo kredit = Rp3.252.353.512,46.
- Oktober 2026: beban debit 5-1150 Rp12.563.000 (neto, setelah kredit Rp4.686.000) dan 5-1200 Rp2.600.000; **5-1300 pembalik overhead (Rp11.372.248)**;
  HPP neto = 12.563.000 + 2.600.000 − 11.372.248 = **Rp3.790.752**; beban operasional Rp130.831.116; laba bersih Rp181.059.633 (konsisten dengan kartu).
- Akun bersaldo terbalik di Neraca Saldo (akan tampil di sisi benar + penanda): `2-1600` Utang Pihak Ketiga (Rp42.398.335 di sisi debit) dan `3-4100` Koreksi Saldo Awal (Rp101.399.427,10 di sisi debit).

## Keputusan terbuka (tidak diputuskan oleh perubahan ini)

1. **Margin belum final.** 254 ISSUE historis tanpa nilai dan reklas lintas bulan (Esa Bumindo/MBB) menunggu keputusan Owner dan akuntan.
   Jangan memposting reklas otomatis; jangan mengklaim margin final selama HPP historis belum lengkap.
2. Kotak "Pembalik jurnal periode sebelumnya" di HPP tetap memakai tanda minus — itu konsep berbeda (koreksi jurnal lintas periode), bukan pembalik beban bersih.

## Risiko dan batasan

- Perubahan hanya penyajian + pembacaan; tidak ada migrasi, tulis data, atau dependensi baru. Rollback = image backend sebelumnya + dist sebelumnya (skrip rilis mencetak instruksi).
- Klien lama (cache PWA) yang belum memuat dist baru tetap menerima field baru tanpa error (field bersifat aditif); `PENANDA_CADANGAN` dipakai bila server lama.
- Excel: kolom "Sifat"/"Sifat Aktual" ditambahkan; pembaca otomatis yang bergantung pada urutan kolom perlu diperiksa.
- Suite penuh: kegagalan yang ada sama dengan baseline (efek CRLF checkout Windows dan berkas yang tidak disentuh); lihat laporan sesi.
