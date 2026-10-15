# Laporan Keuangan Terinci & Penanda Mutu Angka (Okt 2026)

**Fase BACA-SAJA.** Tidak ada tulis ke Payment, harga order, pemakaian bahan, tanggal pengakuan, mapping divisi, jurnal, atau data produksi. Rumus dan angka Laba Rugi
(`services/finance/reports.js#labaRugi`) tidak berubah; modul ini hanya MENELUSURI dan MENGELOMPOKKAN angka yang sama. Dasar kasus: audit baca-saja cutoff 15 Okt 2026 08:32 WIB.

## Arsitektur (satu read-model, dua pemakai)
`services/finance/laporanTerinci/` — dibaca layar **dan** Export Excel (`export/laporan-keuangan.js`); frontend tidak menghitung ulang.

| Berkas | Isi |
|---|---|
| `baris.js` | Baris jurnal Laba Rugi (filter sama dengan `labaRugi()`), efek ke tiap kartu, atribusi divisi dengan kode ASLI `laporanDivisi/atribusi.js`, penyamaran uraian akun sensitif |
| `jembatan.js` | Jembatan omzet Sales Lunas → pendapatan bersih, kelas order, dua residual wajib Rp0 |
| `hpp.js` | HPP terbukukan, biaya tak terbukti (nominal `null`), estimasi informatif (tidak masuk laba), persediaan, pembalik lintas periode, **status mutu margin** |
| `bebanDivisi.js` | Beban per divisi → akun, konflik bukti atribusi, belum teratribusi |
| `pkr.js` | Penjualan Karyawan terpisah dari order Sales |
| `gap.js` | Daftar pemeriksaan gap (BELUM_BERHARGA vs PKR_OPERASIONAL_RP0) + celah tanpa gap |
| `index.js` | Orkestrator: **satu transaksi REPEATABLE READ**, cutoff, kontrol parity |

Endpoint (izin `finance:read`; uraian akun sensitif hanya `finance:admin`):
`GET /api/finance/reports/income-statement/terinci` · `GET …/drilldown?metrik=pendapatan|hpp|laba_kotor|beban_operasional|laba_bersih&akun&divisi&sumber&q` · `POST /api/finance/export/laporan-keuangan`.

## Definisi
* **Cutoff** = waktu pembacaan (WIB & UTC) + tanggal buku jurnal terakhir; dicetak di layar dan di kepala sheet Excel.
* **Periode** = tanggal buku jurnal (WIB), inklusif; status jurnal POSTED + REVERSED.
* **Omzet Sales (Lunas)** = Σ `Order.value`, `paidAt` WIB di periode, status bukan Batal/Pending, pelanggan bukan Spam.
* **Pendapatan** diakui saat order diserahkan; **PKR** saat dokumen dibuat (4-1250) — keduanya ditampilkan terpisah.
* **Status mutu margin**: `TIDAK_BERLAKU` (tak ada unit terkirim) · `BELUM_LENGKAP` (konsumsi bahan periode belum bernilai / tak semua unit terkirim punya pemakaian bernilai → layar: "HPP bahan belum lengkap — margin belum final") · `LENGKAP`.

## Kontrol parity (selalu dihitung, dicetak di layar & Excel)
Kartu = Σ baris jurnal (5 kartu) · residual jembatan Sales/Bruto/Retur/Bersih = 0 · Σ beban per divisi = beban pokok + operasional · PKR 4-1250 = Σ dokumen · jumlah gap = banner.

## Yang TIDAK dilakukan fase ini
Tidak memperbaiki gap, tidak memposting pengakuan, tidak mengubah tanggal pengakuan, tidak mengalokasikan divisi, tidak memasukkan estimasi ke laba. Rancangan koreksi data ada di dokumen terpisah dan memerlukan persetujuan Owner.

## Tes
`backend/tests/integration/laporanKeuanganTerinci.integration.test.js` (parity layar–Excel–ledger, drilldown, jembatan, HPP, divisi/konflik, gap, izin, tanpa data, baca-saja), `frontend/tests/laporanTerinciUI.test.js`, `financeExportCoverage.test.js`, `financeKontrakMetrik.test.js`.
