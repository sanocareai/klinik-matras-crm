# Audit Selisih Laporan 1–31 Oktober 2026 (WIB) — Sales CRM vs Finance Pemasukan vs Excel

Dibuat dari pembacaan produksi **baca-saja** (transaksi `READ ONLY` ditegakkan Postgres; `transaction_read_only = on`) pada release live `a0dbe2fb`, 31 Okt 2026. Tidak ada payment, order, jurnal, refund, nota kredit, atau pengecualian lunas yang diubah.
Kode live dipastikan identik dengan `a0dbe2fb` (hash isi `rekonSalesFinance.js`, `pemasukan.js`, `export/pemasukan.js`, `routes/analytics.js` di container = di repo).

## Ringkasan: tiga angka itu BENAR, tetapi menjawab tiga pertanyaan berbeda

| Angka di layar | Nilai | Pertanyaan yang dijawab | Basis tanggal | Cakupan |
|---|---:|---|---|---|
| Laporan **Ringkasan** › Sudah Lunas | Rp332.086.500 (129 order) | Dari order yang **dibuat** Oktober, berapa yang sekarang Lunas | tanggal order dibuat | seluruh perusahaan, nilai bersih |
| Laporan **Sales** › Nilai Order yang Menjadi Lunas (Tim) | Rp407.817.500 | Order yang **menjadi lunas** di Oktober, milik Tim Sales | tanggal order menjadi lunas (`paidAt`) | Sales aktif + Team Lead; tanpa order tanpa atribusi |
| Finance › Pemasukan › Uang Masuk (terverifikasi) | Rp431.443.000 (176 order, 185 pembayaran) | Uang pelanggan yang **diterima & diverifikasi** di Oktober | tanggal pembayaran diterima | seluruh perusahaan |

Selisih Rp23.625.500 (uang masuk − Tim) dan Rp3.505.501 (SUM mentah Excel − TOTAL) **bukan** kesalahan hitung; keduanya tertutup persis, sampai nomor dokumen, di bawah. **Penyebabnya bukan PKR** (tidak ada order PKR di himpunan lunas Oktober). **Refund Rp200.000 (RES-07102026-037, Sofyan) adalah komponen jembatan yang sah, bukan bug refund**: uang masuk Rp4.300.000 dikurangi refund aktif Rp200.000 = Rp4.100.000 = nilai bersih order, sehingga jembatan menutup tanpa sisa. Angka refund itu benar menurut data; yang masih terbuka hanya keputusan koreksi nilai order (bagian F.4).

## A. Jembatan Rp23.625.500 — Uang Masuk Terverifikasi → Nilai Order Lunas Tim

| Langkah | Jumlah | Order |
|---|---:|---:|
| Uang Masuk Terverifikasi (Finance) | Rp431.443.000 | 176 |
| − DP / parsial, order belum lunas | Rp1.690.000 | 3 |
| − Pembayaran Oktober untuk order yang dihitung lunas di periode lain | Rp16.035.000 | 7 |
| − Penyesuaian refund atas order lunas | Rp200.000 | 1 |
| − Ongkir ikut dibayar (bukan nilai jasa) | Rp410.500 | 4 |
| **= Nilai Order Lunas — Total Perusahaan** | **Rp413.107.500** | 166 |
| − Tanpa atribusi Sales | Rp5.290.000 | 2 |
| **= Nilai Order Lunas — Tim Sales** | **Rp407.817.500** | |

Total pengurang: 1.690.000 + 16.035.000 + 200.000 + 410.500 + 5.290.000 = **Rp23.625.500** (residual jembatan = Rp0, ketiga tahap).

### A1. DP Rp1.690.000 (3 order, belum lunas)
| No. Order | Pelanggan | Sales (percakapan) | Jumlah di jembatan | Payment (ID · nominal · tgl) |
|---|---|---|---|---|
| NEW-01102026-002 | Sulaiman | — | Rp100.000 | `b9a6012e` Rp100.000 2026-10-15 |
| RES-04102026-021 | Wannih | Ervina | Rp300.000 | `3819fe49` Rp300.000 2026-10-04 |
| NEW-27102026-043 | Yoghi Sebastian | Kiki | Rp1.290.000 | `1d8cb853` Rp1.290.000 2026-10-28 |

### A2. Pembayaran untuk order lunas di periode lain Rp16.035.000 (7 order)
Semua tujuh order dihitung lunas pada **30 Sep 2026** (`paidAt`), padahal uangnya masuk Oktober. Dua di antaranya dikunci oleh pengecualian lunas aktif (keputusan Owner 2 Okt: keringanan target Sales September); **lima lainnya pengecualiannya sudah DICABUT 6 Okt ("sudah di tf / sudah di bayar 1 okt"), tetapi tanggal lunasnya tetap 30 Sep** — pencabutan tidak memindahkan `paidAt` ke tanggal bayar.
| No. Order | Pelanggan | Sales (percakapan) | Jumlah di jembatan | Payment (ID · nominal · tgl) | Status pengecualian |
|---|---|---|---|---|---|
| NEW-19092026-035 | Susi Andriani | Kiki | Rp2.250.000 | `da5b7c51` Rp2.250.000 2026-10-11 |  |
| NEW-25092026-042 | Natalia | Kiki | Rp1.100.000 | `124c6165` Rp1.100.000 2026-10-26 |  |
| RES-27092026-161 | Jevi | Kiki | Rp3.505.000 | `ecf5bab7` Rp3.505.000 2026-10-01 |  |
| RES-27092026-163 | BUDI | Kiki | Rp1.200.000 | `5253a897` Rp1.200.000 2026-10-01 |  |
| RES-28092026-173 | Wahyu Andrian | Kiki | Rp3.090.000 | `92436dd6` Rp3.090.000 2026-10-01 |  |
| RES-28092026-174 | Kadarwati | Kiki | Rp2.000.000 | `a047384f` Rp2.000.000 2026-10-05 |  |
| RES-28092026-175 | Kadarwati | Kiki | Rp2.890.000 | `f0b5c128` Rp2.890.000 2026-10-05 |  |

### A3. Refund Rp200.000 (1 order) — komponen sah
Refund aktif mengurangi uang bersih terhadap nilai order. Pada RES-07102026-037: Payment terverifikasi Rp4.300.000 − refund Rp200.000 = Rp4.100.000 = nilai bersih order (residual Rp0). Ini perilaku jembatan yang benar, bukan bug refund.

| No. Order | Pelanggan | Sales | Nilai jasa (bersih) | Payment terverifikasi | Refund aktif |
|---|---|---|---|---|---|
| RES-07102026-037 | Sofyan | Fadlan | Rp4.100.000 | Rp4.300.000 | Rp200.000 |

### A4. Ongkir Rp410.500 (4 order; masuk Payment, bukan nilai jasa)
| No. Order | Pelanggan | Nilai jasa | Ongkir | Total tagihan | Payment (ID · nominal · tgl) |
|---|---|---|---|---|---|
| RES-16102026-080 | .HANDRY | Rp750.000 | Rp80.000 | Rp830.000 | `e8f0d8dd` Rp830.000 2026-10-16 |
| RES-28092026-177 | Devon Javelin | Rp1.400.000 | Rp200.000 | Rp1.600.000 | `84017a42` Rp1.600.000 2026-10-07 |
| RES-28092026-179 | lstynk | Rp1.090.000 | Rp110.000 | Rp1.200.000 | `969d3ff9` Rp1.200.000 2026-10-06 |
| NEW-13102026-024 | Patricia TJ | Rp200.000 | Rp20.500 | Rp220.500 | `ae1c9e70` Rp220.500 2026-10-13 |

### A5. Tanpa atribusi Sales Rp5.290.000 (2 order)
| No. Order | Pelanggan | Nilai | Sebab tanpa atribusi | Payment |
|---|---|---|---|---|
| NEW-01102026-001 | Sulaiman | Rp1.300.000 | Penjualan Karyawan · Sulaiman / Emon | `6a436847` Rp500.000 2026-10-01<br>`74f8e28c` Rp300.000 2026-10-09<br>`1611fd7a` Rp100.000 2026-10-10<br>`3bfde8c8` Rp400.000 2026-10-15 |
| RES-03102026-017 | Sutami | Rp3.990.000 | Pemilik eksplisit bukan Sales aktif | `e28a58ac` Rp3.990.000 2026-10-12 |

- **NEW-01102026-001** (Rp1.300.000): order penjualan staf (`staff_seller_id` = Sulaiman / Emon, peran PRODUCTION_WORKER) — mekanisme lama, **bukan** modul Penjualan Karyawan (`penjualan_karyawan_id` kosong), sehingga tetap masuk omzet perusahaan tetapi tidak ke Tim.
- **RES-03102026-017** (Sutami, Rp3.990.000): **pemilik eksplisit = Suci (SALES, NONAKTIF)**, sedangkan percakapan pelanggan dipegang **Ervina (SALES aktif)**. Aturan "pemilik eksplisit menang" membuat order tidak dihitung ke Sales mana pun. → butuh keputusan (lihat bagian E).

## B. Jembatan Rp3.505.501 — SUM mentah Excel (kategori Uang Masuk) vs TOTAL

Excel Uang Masuk 187 baris: SUM mentah kolom Nilai = Rp434.948.501; TOTAL = Rp431.443.000 (sama dengan layar). Selisih = dua baris yang **tampil tetapi tidak dihitung**:

| Payment | Order | Nilai | Status | Sebab | Pengganti yang dihitung |
|---|---|---:|---|---|---|
| `2cbae1f0` (QRIS, 23 Okt, rek. KEM - Sano Bank) | RES-19102026-093 | Rp3.505.500 | DIBATALKAN 27 Okt | "Dikoreksi — salah tanggal" (sempat terverifikasi) | `d1b0fd36` Rp3.505.500, 27 Okt (dihitung) |
| `2b6beabb` (tunai, 6 Okt) | RES-28092026-179 | Rp1 | DITOLAK | driver (Agung) salah input DP tunai Rp1 pada order Rp1.200.000; atas instruksi Owner 7 Okt; pembayaran benar `969d3ff9` Rp1.200.000 (dihitung) | `969d3ff9` |

3.505.500 + 1 = **Rp3.505.501**. Uang tidak terhitung dua kali dan tidak hilang. Kolom Excel "Nilai" memang memuat keduanya karena itu nilai tercatat tiap baris.

## C. Jembatan kohort: Rp332.086.500 (dibuat Okt & Lunas) → Rp413.107.500 (lunas Okt, Total Perusahaan)

- Kohort dibuat-Oktober yang kini Lunas: **129 order, Rp332.086.500**. Semuanya punya tanggal lunas di Oktober (tidak ada yang lunas tanpa tanggal atau bertanggal bulan lain).
- Order yang **dibuat sebelum Oktober tetapi lunas di Oktober**: **37 order, Rp81.021.000** (tabel di bawah).
- Rp332.086.500 + Rp81.021.000 = **Rp413.107.500** = Total Perusahaan. Residual kohort = Rp0.
- Jadi Rata-rata per Order di Ringkasan (Rp2.375.696 = Rp449.006.500 ÷ 189 order, seluruh perusahaan) dan AOV Tim di Sales (Rp2.484.469) beda populasi — bukan salah satu keliru (lihat `AOV-TIM-SALES.md`).

| No. Order | Pelanggan | Dibuat (WIB) | Lunas (WIB) | Nilai bersih |
|---|---|---|---|---|
| RES-23092026-148 | Bapak Subrata | 2026-09-23 | 2026-10-01 | Rp1.100.000 |
| RES-29092026-191 | Winarni [cs vina] | 2026-09-29 | 2026-10-01 | Rp300.000 |
| RES-10092026-055 | Inge Hardine [cs vina] | 2026-09-10 | 2026-10-02 | Rp2.400.000 |
| RES-28092026-171 | Alessandra Lupita [survey] | 2026-09-28 | 2026-10-02 | Rp2.000.000 |
| RES-23092026-145 | Hadi Ismanto BANDUNG | 2026-09-23 | 2026-10-03 | Rp4.190.000 |
| SWS-28092026-016 | Alessandra Lupita [survey] | 2026-09-28 | 2026-10-03 | Rp200.000 |
| RES-23092026-146 | Rindu Krg Lt 5 Psr Br Bdg | 2026-09-23 | 2026-10-03 | Rp2.000.000 |
| RES-25092026-153 | Sari Sasomo BANDUNG | 2026-09-25 | 2026-10-03 | Rp4.000.000 |
| RES-27092026-162 | +6285974312779 Ibu Aida Cakrawati | 2026-09-27 | 2026-10-03 | Rp2.800.000 |
| RES-26092026-155 | Andi Ari S | 2026-09-26 | 2026-10-04 | Rp4.050.000 |
| RES-29092026-184 | Eva | 2026-09-29 | 2026-10-05 | Rp1.800.000 |
| RES-29092026-185 | Eva | 2026-09-29 | 2026-10-05 | Rp700.000 |
| RES-29092026-188 | Dea | 2026-09-29 | 2026-10-05 | Rp1.600.000 |
| RES-27092026-164 | Ade Natalia [Cs vina] | 2026-09-27 | 2026-10-05 | Rp3.690.000 |
| SWS-27092026-013 | Ade Natalia [Cs vina] | 2026-09-27 | 2026-10-05 | Rp200.000 |
| RES-29092026-181 | Yuni | 2026-09-29 | 2026-10-05 | Rp4.000.000 |
| RES-29092026-186 | A.F | 2026-09-29 | 2026-10-05 | Rp900.000 |
| RES-28092026-169 | Taridody | 2026-09-28 | 2026-10-06 | Rp3.690.000 |
| RES-28092026-170 | Realino | 2026-09-28 | 2026-10-06 | Rp3.990.000 |
| RES-28092026-179 | lstynk | 2026-09-28 | 2026-10-06 | Rp1.090.000 |
| RES-29092026-182 | helmi | 2026-09-29 | 2026-10-07 | Rp1.500.000 |
| RES-21092026-131 | prima | 2026-09-21 | 2026-10-07 | Rp1.900.000 |
| RES-30092026-194 | Sonya | 2026-09-30 | 2026-10-07 | Rp1.050.000 |
| RES-28092026-177 | Devon Javelin | 2026-09-28 | 2026-10-07 | Rp1.400.000 |
| RES-02092026-011 | Julhan | 2026-09-02 | 2026-10-08 | Rp1.500.000 |
| RES-07092026-034 | Julhan | 2026-09-07 | 2026-10-08 | Rp1.500.000 |
| RES-30092026-195 | mulyani | 2026-09-30 | 2026-10-08 | Rp1.000.000 |
| NEW-30082026-024 | Leo Witarsa | 2026-08-30 | 2026-10-08 | Rp2.961.000 |
| RES-30092026-193 | Maya Zea | 2026-09-30 | 2026-10-08 | Rp4.790.000 |
| RES-29092026-189 | Yani Bandung | 2026-09-29 | 2026-10-09 | Rp2.590.000 |
| SWS-30092026-018 | SB [Cs vina] | 2026-09-30 | 2026-10-10 | Rp200.000 |
| RES-28092026-176 | Effendi Bekasi 1070 | 2026-09-28 | 2026-10-13 | Rp3.690.000 |
| RES-23092026-149 | Iqbal Farhanuddin | 2026-09-23 | 2026-10-14 | Rp2.900.000 |
| RES-10092026-053 | David Liem | 2026-09-10 | 2026-10-15 | Rp1.950.000 |
| RES-28092026-172 | Eka Endah Susanti/Okta (Novia) | 2026-09-28 | 2026-10-16 | Rp2.000.000 |
| RES-08092026-044 | Vieldhie | 2026-09-08 | 2026-10-23 | Rp3.290.000 |
| RES-28092026-180 | Cueng Bandung | 2026-09-28 | 2026-10-29 | Rp2.100.000 |

## D. Yang diperbaiki di kode (tanpa mengubah data)

| # | Temuan | Perbaikan |
|---|---|---|
| 1 | Excel Pemasukan: TOTAL benar, tetapi pembaca yang menjumlah kolom Nilai mendapat angka lain tanpa alasan di berkas | Kolom **Dihitung ke Total?**, **Nilai yang Dihitung (Rp)**, **Alasan Tidak Dihitung**; "Nilai (Rp)" historis dipertahankan; TOTAL ada di kolom baru sehingga SUM kolom baru = TOTAL = layar. Satu aturan server (`statusHitungTotal`) dipakai layar dan Excel. Pembayaran dibatalkan menautkan pembayaran penggantinya. Sheet Rekap diberi kolom nilai-dihitung. |
| 2 | Total layar arsip historis menjumlah semua baris (termasuk Duplikat/Perlu Ditinjau) padahal kartu "Pendapatan historis" hanya yang SIAP/diterima | Aturan dihitung disamakan; baris tak dihitung punya alasan. (Oktober 2026: 0 baris historis, tidak berdampak angka.) |
| 3 | Rekonsiliasi memasukkan order **Penjualan Karyawan (PKR)** ke himpunan lunas-periode, padahal kartu Sales/komisi mengecualikannya | Dikecualikan (sama dengan `tanpaOrderSpam`). Dampak Oktober 2026 = Rp0 (tidak ada order PKR lunas di periode); pencegahan. |
| 4 | Tidak ada jembatan antara kartu "Sudah Lunas" (dibuat) dan "Menjadi Lunas" (tanggal lunas) | **Jembatan kohort** baru, sampai nomor order, residual Rp0, termasuk status Excel. |
| 5 | Jembatan tidak menunjuk dokumen pembayaran | Tiap Payment di rincian memuat ID, tanggal WIB, rekening, nomor jurnal (null bila belum dijurnal), di layar dan Excel ("Dokumen Pembayaran"). |
| 6 | Alasan "lunas periode lain" tidak membedakan pengecualian aktif, dicabut, atau memang bulan lain | Alasan tertulis per order, termasuk "pengecualian DICABUT, tanggal lunas tetap …, perlu keputusan Owner". |
| 7 | Label/tooltip tidak menyebut basis tanggal & cakupan | Tooltip kartu Sales dan Ringkasan menyebut BASIS (dibuat vs menjadi lunas) dan cakupan; kalimat Owner di kartu "Nilai Order yang Menjadi Lunas" dipertahankan persis. Tiga metrik baru masuk kontrak (`nilai_order_lunas_kohort_dibuat`, `perlu_verifikasi_finance`, `pemasukan_lain`). |

Tidak ada bug perhitungan yang mengubah angka Oktober 2026 — ketiga angka acuan tetap sama sebelum dan sesudah; yang berubah adalah keterbacaan dan bukti.

## E. Sebelum / sesudah (Oktober 2026)

| Item | Sebelum (live a0dbe2fb) | Sesudah (kandidat) |
|---|---|---|
| Uang Masuk terverifikasi (layar) | Rp431.443.000 | Rp431.443.000 (tidak berubah) |
| TOTAL Excel Uang Masuk | Rp431.443.000 di kolom "Nilai (Rp)" | Rp431.443.000 di kolom "Nilai yang Dihitung (Rp)" |
| SUM mentah kolom "Nilai (Rp)" | Rp434.948.501 (selisih tak dijelaskan di berkas) | Rp434.948.501 dipertahankan; selisih Rp3.505.501 = 2 baris "Tidak" dengan alasan |
| SUM kolom "Nilai yang Dihitung" | — | Rp431.443.000 (= TOTAL = layar) |
| Nilai Order Lunas Tim / Total Perusahaan | Rp407.817.500 / Rp413.107.500 | sama |
| Jembatan kohort Rp332.086.500 → Rp413.107.500 | tidak ada | ada, 37 order, residual Rp0 |
| Dokumen pembayaran per order di jembatan | tidak ada | ID · tanggal · rekening · jurnal |

**Catatan verifikasi:** kode kandidat **belum dijalankan terhadap data produksi** (menyalin kode ke container produksi tidak diizinkan dalam audit baca-saja). Bukti kandidat: tes integrasi DB terisolasi (rekon 12/12, pemasukan 11/11, export 5/5, termasuk pembayaran ditolak/dibatalkan + pengganti, pengecualian lunas aktif dan dicabut, order PKR, DP lintas bulan, ongkir, refund, order tanpa Sales, batas tanggal WIB, kohort) dan rehearsal lokal pada DB berisi skenario Oktober. Pada data nyata, skrip rilis menjalankan kode kandidat sebagai server terhadap **salinan restore produksi** untuk Agustus/September/Oktober dan baru lanjut bila semua parity lulus.

## F. Keputusan manusia yang masih terbuka (tidak diubah oleh rilis ini)

1. **RES-03102026-017 (Rp3.990.000, Sutami)** — pemilik eksplisit Suci (nonaktif), percakapan dipegang Ervina. Tetapkan pemilik ke Ervina lewat "Tetapkan Sales" (Admin, beralasan, teraudit) **atau** putuskan bahwa pemilik nonaktif harus jatuh ke pemegang percakapan. Dampak: Nilai Lunas Tim Oktober +Rp3.990.000 dan Target/komisi Ervina.
2. **Lima order September dengan pengecualian dicabut (Rp12.685.000)**: RES-27092026-161 (3.505.000), RES-27092026-163 (1.200.000), RES-28092026-173 (3.090.000), RES-28092026-174 (2.000.000), RES-28092026-175 (2.890.000) — uang masuk 1–5 Okt, tanggal lunas tetap 30 Sep. Putuskan: biarkan (September sudah tutup, insentif 120 jt dihitung), atau pindahkan tanggal lunas ke tanggal bayar (mengubah laporan September dan Oktober).
3. **Order staf lama** NEW-01102026-001 (Rp1.300.000) dan NEW-01102026-002 (DP Rp100.000), pembeli Sulaiman / Emon — masuk omzet perusahaan tetapi bukan Tim. Putuskan: dibiarkan sebagai penjualan staf lama atau dimigrasikan ke modul Penjualan Karyawan.
4. **RES-07102026-037 (Sofyan) — koreksi nilai order**: refund Rp200.000 sudah benar dan tercatat sebagai komponen jembatan (A3); yang menunggu konfirmasi Owner hanya apakah nilai order dikoreksi. Rilis ini tidak menyentuh koreksi itu.
