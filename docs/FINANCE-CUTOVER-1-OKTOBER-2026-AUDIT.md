# Audit Kesiapan Cutover Persediaan 1 Oktober 2026 (baca-saja)

Diaudit 29 September 2026 ± 03.40 WIB langsung ke database produksi (transaksi read-only, tanpa satu pun tulis). Tanggal cutover **tetap 1 Oktober 2026**.
Persediaan awal **belum diposting** dan tidak ada data/harga yang diisi berdasarkan asumsi.

## 1. Keputusan gate resmi sistem (`GET /api/finance/persediaan-awal/kesiapan`)

**NO-GO — 3 dari 7 syarat belum terpenuhi.** Gate 29 Sep 2026 17.00 WIB belum lewat.

| Syarat | Status | Keterangan |
|---|---|---|
| PIN Finance Owner terpasang | OK | Hanya **Kemal** yang sudah memasang PIN (Gilang & Juri belum) |
| Pemeriksa Gudang (peran WAREHOUSE) | **GAGAL** | **0 pengguna** berperan WAREHOUSE. Peran ini satu-satunya pemegang `inventory:write` |
| Snapshot dibuat | OK | PSA-30092026-001, status **Draf** |
| Masalah satuan | OK (semu) | Snapshot **berisi 0 baris**, jadi belum ada yang diperiksa |
| Semua material fisik positif punya dokumen harga | **GAGAL** | 0 baris — belum ada stok fisik yang diinput |
| Harga tidak wajar dijelaskan | OK (semu) | 0 baris — belum ada yang dinilai |
| Diperiksa Finance **dan** Gudang | **GAGAL** | Belum ada pemeriksaan sama sekali |

## 2. Temuan audit

1. **Snapshot PSA-30092026-001 kosong** (0 baris, `total_value` kosong). Dibuat 28 Sep 02.45 UTC, belum disentuh. Waktu hitung tercatat (`counted_at`) = 30 Sep 2026 23.59 WIB.
2. **Tidak ada satu pun material yang punya harga bersumber dokumen.** `stock_movements` hanya berisi 254 ISSUE + 106 ADJUSTMENT; **0 RECEIPT**, **0 goods receipt**. Harga per unit hanya ada sebagai `referenceUnitCost` (snapshot impor Agustus 2026) — itu hanya pembanding, TIDAK boleh dipakai sebagai harga snapshot. Di sistem ada 13 tagihan supplier & 363 pembelian, tetapi tidak berbaris-item per material, jadi pemetaan ke material harus dilakukan manusia (Finance) dengan membuka faktur.
3. **Stok sistem basi.** Pergerakan stok terakhir 8 Sep 2026 (00.00 WIB); 22 hari (9–30 Sep) belum tercatat. Stok sistem hanya pembanding; yang menentukan nilai persediaan adalah stok opname fisik.
4. **Material dengan stok sistem positif: 101** (nilai referensi total ≈ Rp549,8 jt, **termasuk anomali Rp386 jt**, tanpa anomali ≈ Rp163,5 jt). Semua punya harga referensi (bulan 2026-08); 0 material positif nonaktif. **Material stok sistem negatif: 21** (fisik tidak mungkin negatif → wajib dirapikan Gudang).
5. **1 anomali nilai:** KAYU-RACUK-2X5 (240 ROD × Rp1.609.500 = Rp386,28 jt). Harga kemungkinan per m³/ikat, bukan per batang — bila dipakai apa adanya persediaan awal membengkak ≈ Rp386 jt. Harus ditentukan Gudang+Finance dari faktur.
6. **Kecurigaan satuan** (dari pola data, bukan asumsi harga): LIST-WIBING-ABU/PUTIH/COKLAT (−388,5 / −360 / −116,5 **ROLL**, harga ref Rp94.350 — kuantitas sebesar itu tidak masuk akal untuk roll; kemungkinan meter/pack), BUSA-HR-FOAM-37N-SKY-112X200X1-50M (0,5 ROLL), dan 2 busa berstatus PCS sedangkan sejenisnya SHEET (BUSA-REBONDED-YL-150X190X14-D50, -170X190X14-D50).
7. **Tidak ada pergerakan stok setelah waktu hitung** (0 baris `created_at > 30 Sep 23.59 WIB`); tidak ada pergerakan sama sekali sejak 8 Sep. Periode September **OPEN** (jurnal 30 Sep bisa diposting). Saldo 1-1400 s.d. 30 Sep = Rp0, sehingga penyesuaian = seluruh nilai stok fisik.
8. **Owner untuk posting:** Gilang, Juri, Kemal (semua OWNER+ADMIN+FINANCE). PIN baru terpasang di Kemal → hanya Kemal yang bisa memposting sekarang.
9. **Tidak ada blocker kode.** Jalur snapshot → periksa (2 orang beda) → pratinjau → posting (OWNER+PIN, sekali, ber-hash) → penilaian perpetual (`hargaRataRata` membaca baris snapshot) sudah lengkap dan konsisten dengan kebijakan. Tidak ada perubahan kode pada Bagian A.
10. **Alur Gudang belum pernah dijalankan di produksi:** 0 goods receipt, 0 material issue. Mulai 1 Okt tagihan bahan baku **tanpa Penerimaan Barang Gudang ditolak** (metode perpetual) — Gudang harus sudah bisa membuat Penerimaan Barang sebelum tagihan bahan baku pertama Oktober dicatat.

## 3. Blocker konkret (harus selesai sebelum posting)

| # | Blocker | Pemilik | Batas |
|---|---|---|---|
| B1 | Beri peran **WAREHOUSE** ke minimal 1 orang (Pengguna & Peran). Pemeriksa Gudang ≠ pemeriksa Finance. | Owner | 29 Sep sebelum 17.00 |
| B2 | Hitung fisik **seluruh** material (bukan hanya 101 positif) dan isi snapshot: kode, qty, satuan = satuan master, harga, sumber (Faktur/Tagihan/Pembelian/Lainnya), nomor dokumen. | Gudang + Finance | 30 Sep |
| B3 | Harga + nomor dokumen sumber untuk setiap material qty > 0 (tidak boleh dari harga referensi otomatis). | Finance | 30 Sep |
| B4 | Putuskan satuan/harga KAYU-RACUK-2X5, 3 LIST-WIBING, BUSA-HR-FOAM-37N-SKY; tulis penjelasan harga (≥10 karakter) bila harga di luar 1/5×–5× harga referensi atau > Rp50 jt per baris. | Gudang + Finance | 30 Sep |
| B5 | Rapikan 21 material stok sistem negatif (stock count/penyesuaian **bertanggal sebelum 1 Okt**), agar `SELISIH_SISTEM` minimal dan pengeluaran bahan Oktober memakai qty benar. | Gudang | 30 Sep |
| B6 | Pasang PIN Finance untuk minimal 1 Owner lagi (cadangan Kemal): Gilang, Juri. | Owner | 30 Sep |
| B7 | Dua pemeriksa berbeda menekan Periksa (Finance dan Gudang) → status DIPERIKSA. | Finance + Gudang | 30 Sep |

Bila B1–B7 tidak selesai sebelum gate: kebijakan gate yang sudah ada menyarankan menggeser cutover ke 1 Nov 2026. **Keputusan itu ada di Owner** — tanggal cutover tidak diubah oleh audit ini.

## 4. Checklist operasional

### Selasa 29 September
- [ ] (pagi) Owner memberi peran WAREHOUSE (B1) dan memastikan Gudang mengenal menu Persediaan Awal.
- [ ] Owner Gilang & Juri memasang PIN Finance (B6).
- [ ] Bekukan pergerakan stok: tidak ada penerimaan/pengeluaran/transfer/penyesuaian tanpa dicatat sampai opname selesai. Catat semua di kertas bertanggal-jam; jangan diinput mundur setelah snapshot diperiksa.
- [ ] Gudang mulai hitung fisik gudang utama (urut per kategori: busa, kain, pegas, kayu/rangka, PE/aksesori, kasur jadi/sewa).
- [ ] Finance kumpulkan faktur/tagihan/pembelian per material (B3).
- [ ] 17.00 WIB: buka `GET /api/finance/persediaan-awal/kesiapan`, catat sisa syarat. Bila masih NO-GO → Owner memutuskan lanjut atau geser ke 1 Nov.

### Rabu 30 September
- [ ] Selesaikan hitung fisik; isi snapshot PSA-30092026-001 lewat Tempel CSV (mode ganti). Qty 0 tetap dicatat sebagai bukti "sudah dihitung".
- [ ] Selesaikan B4 & B5; cek layar Blocker sampai kosong; baca ulang Peringatan (SELISIH_SISTEM, MATERIAL_TIDAK_DIHITUNG).
- [ ] Finance Periksa; Gudang Periksa (orang berbeda) → DIPERIKSA (isi terkunci, ber-hash).
- [ ] Owner tinjau Pratinjau Jurnal: **Dr 1-1400 / Cr 5-1100 sebesar total stok fisik** (saldo buku 1-1400 saat ini Rp0).
- [ ] Owner memposting (PIN + alasan) — jurnal bertanggal **30 Sep 2026**. Tidak dilakukan oleh audit ini.
- [ ] Setelah posting: pastikan kebijakan terkunci (`terkunci: true`), tepat 1 jurnal PERSEDIAAN_AWAL, dan laporan pengecualian bersih.
- [ ] Siapkan Gudang: Penerimaan Barang untuk pembelian bahan baku Oktober; tagihan bahan baku wajib menaut Penerimaan Barang.

### Kamis 1 Oktober (hari pertama perpetual)
- [ ] Verifikasi penerimaan/pengeluaran pertama terjurnal (Dr 1-1400 / Cr 2-1150, Dr 5-1100 / Cr 1-1400) dan tidak ada gap `PERSEDIAAN_AWAL_BELUM_DIPOSTING`.

## 5. Daftar material per stok sistem (bahan pembanding untuk hitung fisik)

Kolom **Flag** = hal yang harus dijawab Gudang/Finance sebelum baris dapat diisi. Stok sistem bukan angka final; nilai referensi bukan harga snapshot.

| Kode | Satuan | Stok sistem | Harga ref (Rp) | Nilai ref (Rp) | Flag |
|---|---|---:|---:|---:|---|
| KAYU-RACUK-2X5 | ROD | 240.00 | 1.609.500 | 386.280.000 | ANOMALI NILAI >Rp50jt — cek satuan/harga |
| KAIN-KNITTING-PREMIUM-STANDARD | METER | 318.50 | 35.000 | 11.147.500 | perlu qty fisik + harga + dokumen |
| PE-ENCASEMENT-195X19X4-MBB | PCS | 329.00 | 24.601 | 8.093.729 | perlu qty fisik + harga + dokumen |
| KASUR-POCKET-PREMIUM-PILLOWTOP-160X200 | PCS | 8.00 | 1.000.000 | 8.000.000 | perlu qty fisik + harga + dokumen |
| CANGKANG-KANCING | PACK | 80.00 | 95.000 | 7.600.000 | perlu qty fisik + harga + dokumen |
| HARDPAD-FUJIPO | KG | 210.00 | 35.000 | 7.350.000 | perlu qty fisik + harga + dokumen |
| PE-ENCASEMENT-200X19X5-MBB | PCS | 200.00 | 31.540 | 6.308.000 | perlu qty fisik + harga + dokumen |
| KASUR-LATEX-PREMIUM-PILLOWTOP-180X200 | PCS | 4.00 | 1.500.000 | 6.000.000 | perlu qty fisik + harga + dokumen |
| PE-ENCASEMENT-195X14X4-MBB | PCS | 295.00 | 18.127 | 5.347.465 | perlu qty fisik + harga + dokumen |
| KASUR-BONEL-PREMIUM-PILLOWTOP-160X200 | PCS | 5.00 | 1.000.000 | 5.000.000 | perlu qty fisik + harga + dokumen |
| KASUR-LATEX-PREMIUM-PILLOWTOP-160X200 | PCS | 3.00 | 1.500.000 | 4.500.000 | perlu qty fisik + harga + dokumen |
| BUSA-REBONDED-MF-90X200X10CM-D40 | SHEET | 24.00 | 171.000 | 4.104.000 | perlu qty fisik + harga + dokumen |
| KASUR-S-SEWA-B70160X200 | PCS | 4.00 | 1.000.000 | 4.000.000 | perlu qty fisik + harga + dokumen |
| BUSA-REBONDED-MF-180X200X4CM-D60 | SHEET | 20.00 | 183.600 | 3.672.000 | perlu qty fisik + harga + dokumen |
| KASUR-S-SEWA-B70180X200 | PCS | 3.00 | 1.100.000 | 3.300.000 | perlu qty fisik + harga + dokumen |
| BUSA-REBONDED-YL-190X170X14-D50 | SHEET | 5.00 | 587.860 | 2.939.300 | perlu qty fisik + harga + dokumen |
| BONNEL-SPRING-180X200 | PCS | 17.00 | 160.000 | 2.720.000 | perlu qty fisik + harga + dokumen |
| PE-ENCASEMENT-195X14X5-MBB | PCS | 120.00 | 21.520 | 2.582.400 | perlu qty fisik + harga + dokumen |
| PE-ENCASEMENT-155X19X4-MBB | PCS | 125.00 | 19.555 | 2.444.375 | perlu qty fisik + harga + dokumen |
| BUSA-REBONDED-MF-80X200X4CM-D40 | SHEET | 40.00 | 60.800 | 2.432.000 | perlu qty fisik + harga + dokumen |
| POCKET-SPRING-180X200 | PCS | 12.00 | 200.000 | 2.400.000 | perlu qty fisik + harga + dokumen |
| KASUR-S-SEWA-B70-200X200 | PCS | 2.00 | 1.200.000 | 2.400.000 | perlu qty fisik + harga + dokumen |
| BUSA-REBONDED-YL-190X170X19-D50 | SHEET | 3.00 | 797.810 | 2.393.430 | perlu qty fisik + harga + dokumen |
| BUSA-HR-FOAM-KULIT-120X2CM | KG | 64.00 | 35.000 | 2.240.000 | perlu qty fisik + harga + dokumen |
| PE-ENCASEMENT-175X19X4-MBB | PCS | 100.00 | 22.078 | 2.207.800 | perlu qty fisik + harga + dokumen |
| KASUR-BONEL-PREMIUM-PILLOWTOP-180X200 | PCS | 2.00 | 1.100.000 | 2.200.000 | perlu qty fisik + harga + dokumen |
| KAIN-TABENG-HIKARON-IVONNA-270-CINNAMON-COKLAT-TUA | METER | 103.00 | 20.000 | 2.060.000 | perlu qty fisik + harga + dokumen |
| BUSA-OCEAN-D18-200X200X2CM | SHEET | 17.00 | 110.800 | 1.883.600 | perlu qty fisik + harga + dokumen |
| BUSA-REBONDED-YL-190X190X10-D50 | SHEET | 4.00 | 469.300 | 1.877.200 | perlu qty fisik + harga + dokumen |
| PE-ENCASEMENT-155X14X4-MBB | PCS | 125.00 | 14.409 | 1.801.125 | perlu qty fisik + harga + dokumen |
| KASUR-BONEL-PREMIUM-PILLOWTOP-120X200 | PCS | 2.00 | 900.000 | 1.800.000 | perlu qty fisik + harga + dokumen |
| BONNEL-SPRING-160X200 | PCS | 12.00 | 150.000 | 1.800.000 | perlu qty fisik + harga + dokumen |
| KASUR-S-SEWA120X200X16 | PCS | 2.00 | 900.000 | 1.800.000 | perlu qty fisik + harga + dokumen |
| BUSA-REBONDED-MF-160X200X4CM-D60 | SHEET | 11.00 | 163.200 | 1.795.200 | perlu qty fisik + harga + dokumen |
| BUSA-ROLL-HR-FOAM-120X1CM-N44 | KG | 45.90 | 36.000 | 1.652.400 | perlu qty fisik + harga + dokumen |
| KAIN-TABENG-HIKARON-IVONNA-287-PEANUT-COKLAT-TUA | METER | 80.00 | 20.000 | 1.600.000 | perlu qty fisik + harga + dokumen |
| BUSA-REBONDED-YL-190X150X14-D50 | SHEET | 3.00 | 518.700 | 1.556.100 | perlu qty fisik + harga + dokumen |
| BUSA-REBONDED-YL-180X200X4-D50 | SHEET | 8.00 | 187.200 | 1.497.600 | perlu qty fisik + harga + dokumen |
| BUSA-MEMORY-FOAM-OCEAN-180X200X2CM | SHEET | 5.00 | 298.800 | 1.494.000 | perlu qty fisik + harga + dokumen |
| KAIN-TABENG-HIKARON-IVONNA-290-GRANITE | METER | 73.00 | 20.000 | 1.460.000 | perlu qty fisik + harga + dokumen |
| KAIN-TABENG-HIKARON-IVONNA-247-SILVER | METER | 65.00 | 20.000 | 1.300.000 | perlu qty fisik + harga + dokumen |
| BUSA-REBONDED-YL-200X200X4-D50 | SHEET | 6.00 | 208.000 | 1.248.000 | perlu qty fisik + harga + dokumen |
| KASUR-POCKET-PREMIUM-PILLOWTOP-180X200 | PCS | 1.00 | 1.100.000 | 1.100.000 | perlu qty fisik + harga + dokumen |
| PE-ENCASEMENT-115X19X4-MBB | PCS | 75.00 | 14.508 | 1.088.100 | perlu qty fisik + harga + dokumen |
| POCKET-SPRING-160X200 | PCS | 6.00 | 180.000 | 1.080.000 | perlu qty fisik + harga + dokumen |
| RANGKA-150X190X10CM | PCS | 4.00 | 250.000 | 1.000.000 | perlu qty fisik + harga + dokumen |
| SPRAY-GUN | PCS | 4.00 | 250.000 | 1.000.000 | perlu qty fisik + harga + dokumen |
| BUSA-MEMORY-FOAM-OCEAN-200X200X2CM | SHEET | 3.00 | 332.000 | 996.000 | perlu qty fisik + harga + dokumen |
| BUSA-ROLL-INOAC | KG | 27.00 | 35.000 | 945.000 | perlu qty fisik + harga + dokumen |
| BUSA-LATEX-D-85-180X200X2-5-CM-KODE-104 | SHEET | 1.00 | 900.000 | 900.000 | perlu qty fisik + harga + dokumen |
| BUSA-OCEAN-D18-180X200X2CM | SHEET | 9.00 | 99.720 | 897.480 | perlu qty fisik + harga + dokumen |
| BUSA-SOFT-FOAM-OCEAN-D22-180X200X2CM | SHEET | 6.00 | 149.040 | 894.240 | perlu qty fisik + harga + dokumen |
| PE-ENCASEMENT-175X14X4-MBB | PCS | 50.00 | 16.268 | 813.400 | perlu qty fisik + harga + dokumen |
| BUSA-REBONDED-SKY-160X200X10-D70 | SHEET | 2.00 | 397.824 | 795.648 | perlu qty fisik + harga + dokumen |
| BUSA-REBONDED-MF-150X190X5CM-D50 | SHEET | 4.00 | 190.400 | 761.600 | perlu qty fisik + harga + dokumen |
| BUSA-REBONDED-YL-190X110X14-D50 | SHEET | 2.00 | 380.380 | 760.760 | perlu qty fisik + harga + dokumen |
| RANGKA-170X190X10CM | PCS | 3.00 | 250.000 | 750.000 | perlu qty fisik + harga + dokumen |
| BUSA-HR-FOAM-37N-SKY-112X200X1-50M | ROLL | 0.50 | 1.473.192 | 736.596 | QTY PECAHAN pada satuan bulat — cek satuan |
| BUSA-REBONDED-YL-190X150X19-D50 | SHEET | 1.00 | 703.950 | 703.950 | perlu qty fisik + harga + dokumen |
| BUSA-REBONDED-BATU | KG | 50.00 | 14.000 | 700.000 | perlu qty fisik + harga + dokumen |
| POCKET-SPRING-200X200 | PCS | 3.00 | 220.000 | 660.000 | perlu qty fisik + harga + dokumen |
| COVER-KASUR-SEWA-180X200 | PCS | 4.00 | 160.000 | 640.000 | perlu qty fisik + harga + dokumen |
| SPANBON-75GRAM | METER | 100.00 | 6.200 | 620.000 | perlu qty fisik + harga + dokumen |
| BONNEL-SPRING-120X200 | PCS | 5.00 | 100.000 | 500.000 | perlu qty fisik + harga + dokumen |
| BUSA-REBONDED-SKY-200X200X10-D70 | SHEET | 1.00 | 497.280 | 497.280 | perlu qty fisik + harga + dokumen |
| BUSA-REBONDED-SKY-180X200X10-D70 | SHEET | 1.00 | 447.552 | 447.552 | perlu qty fisik + harga + dokumen |
| SAKURA-HITAM-6CM | PCS | 400.00 | 1.000 | 400.000 | perlu qty fisik + harga + dokumen |
| KAIN-OSCAR-MIO-CREAM | METER | 6.00 | 62.160 | 372.960 | perlu qty fisik + harga + dokumen |
| COVER-KASUR-SEWA-YG-RUSAK-200X200 | PCS | 2.00 | 170.000 | 340.000 | perlu qty fisik + harga + dokumen |
| BONNEL-SPRING-200X200 | PCS | 2.00 | 170.000 | 340.000 | perlu qty fisik + harga + dokumen |
| BUSA-REBONDED-YL-160X200X4-D50 | SHEET | 2.00 | 166.400 | 332.800 | perlu qty fisik + harga + dokumen |
| KAIN-KNITTING-GELAP-KG | KG | 17.00 | 16.650 | 283.050 | perlu qty fisik + harga + dokumen |
| PE-FOAM-SHEET-160X200X5-MBB | PCS | 1.00 | 252.252 | 252.252 | perlu qty fisik + harga + dokumen |
| BUSA-REBONDED-YL-120X200X4-D50 | SHEET | 2.00 | 124.800 | 249.600 | perlu qty fisik + harga + dokumen |
| COVER-KASUR-SEWA-120X200 | PCS | 2.00 | 120.000 | 240.000 | perlu qty fisik + harga + dokumen |
| TALI-TIS-40-CM | PACK | 5.00 | 45.000 | 225.000 | perlu qty fisik + harga + dokumen |
| GERGAJI | PCS | 2.00 | 100.000 | 200.000 | perlu qty fisik + harga + dokumen |
| KAIN-QUILTING-1CM-PUTIH | METER | 3.00 | 66.000 | 198.000 | perlu qty fisik + harga + dokumen |
| PE-TABUNG-15-CM | PCS | 132.00 | 1.440 | 190.080 | perlu qty fisik + harga + dokumen |
| MATA-KANCING-0-32 | PCS | 1.00 | 172.050 | 172.050 | perlu qty fisik + harga + dokumen |
| LIST-CORNER-PUTIH-40CMX90Y-82MTR | ROLL | 2.00 | 86.000 | 172.000 | perlu qty fisik + harga + dokumen |
| LIST-CORNER-COKLAT-40CMX90Y-82MTR | ROLL | 2.00 | 85.000 | 170.000 | perlu qty fisik + harga + dokumen |
| COVER-KASUR-SEWA-YG-RUSAK-180X200 | PCS | 1.00 | 160.000 | 160.000 | perlu qty fisik + harga + dokumen |
| COVER-KASUR-SEWA-160X200 | PCS | 1.00 | 150.000 | 150.000 | perlu qty fisik + harga + dokumen |
| RODA | PCS | 30.00 | 5.000 | 150.000 | perlu qty fisik + harga + dokumen |
| COVER-KASUR-SEWA-YG-RUSAK-160X200 | PCS | 1.00 | 150.000 | 150.000 | perlu qty fisik + harga + dokumen |
| PE-TABUNG-17-CM | PCS | 93.00 | 1.605 | 149.265 | perlu qty fisik + harga + dokumen |
| SUDUT-GOLD | PCS | 90.00 | 1.500 | 135.000 | perlu qty fisik + harga + dokumen |
| POCKET-SPRING-120X200 | PCS | 1.00 | 120.000 | 120.000 | perlu qty fisik + harga + dokumen |
| BONNEL-SPRING-140X200 | PCS | 1.00 | 120.000 | 120.000 | perlu qty fisik + harga + dokumen |
| SELANG | PCS | 8.00 | 15.000 | 120.000 | perlu qty fisik + harga + dokumen |
| PE-FOAM-SHEET-180X200X2-MBB | PCS | 1.00 | 113.514 | 113.514 | perlu qty fisik + harga + dokumen |
| BUSA-SOFT-FOAM-35SS-SKY-160X200X2 | SHEET | 1.00 | 110.112 | 110.112 | perlu qty fisik + harga + dokumen |
| KAKI-RETRO-15-CM | PCS | 6.00 | 18.000 | 108.000 | perlu qty fisik + harga + dokumen |
| COVER-KASUR-SEWA-100X200 | PCS | 1.00 | 100.000 | 100.000 | perlu qty fisik + harga + dokumen |
| STREPLES-10-13 | PACK | 3.00 | 25.530 | 76.590 | perlu qty fisik + harga + dokumen |
| BADAN-RESLETING-YKK-NO-5 | PACK | 1.00 | 72.000 | 72.000 | perlu qty fisik + harga + dokumen |
| BENANG-GUJIR | PACK | 1.00 | 70.000 | 70.000 | perlu qty fisik + harga + dokumen |
| KAIN-LAVA-B-GRADE | METER | 2.20 | 25.641 | 56.410 | perlu qty fisik + harga + dokumen |
| BUSA-SOFT-FOAM-35SS-SKY-160X200X1 | SHEET | 1.00 | 55.056 | 55.056 | perlu qty fisik + harga + dokumen |
| RING-350 | PCS | 70.00 | 350 | 24.500 | perlu qty fisik + harga + dokumen |
| BUSA-REBONDED-YL-120X200X14-D60 | SHEET | -4.00 | - | - | STOK SISTEM NEGATIF — Gudang opname/penyesuaian; TANPA harga referensi |
| TRIPLEK-12ML | SHEET | -1.00 | - | - | STOK SISTEM NEGATIF — Gudang opname/penyesuaian; TANPA harga referensi |
| BUSA-REBONDED-YL-200X200X2-D50 | SHEET | -6.00 | - | - | STOK SISTEM NEGATIF — Gudang opname/penyesuaian; TANPA harga referensi |
| BUSA-OCEAN-D18-120X200X2CM | SHEET | -1.00 | 66.480 | -66.480 | STOK SISTEM NEGATIF — Gudang opname/penyesuaian |
| HR-22-ISI-STEPLES | BOX | -1.00 | 70.000 | -70.000 | STOK SISTEM NEGATIF — Gudang opname/penyesuaian |
| KAIN-LAVA-PREMIUM-COOLING | METER | -2.10 | 79.032 | -165.967 | STOK SISTEM NEGATIF — Gudang opname/penyesuaian |
| BUSA-REBONDED-YL-160X200X2-D50 | SHEET | -3.00 | 76.800 | -230.400 | STOK SISTEM NEGATIF — Gudang opname/penyesuaian |
| BUSA-OCEAN-D18-160X200X2CM | SHEET | -3.00 | 88.640 | -265.920 | STOK SISTEM NEGATIF — Gudang opname/penyesuaian |
| COTTON-SHEET-0-5 | ROLL | -8.00 | 35.000 | -280.000 | STOK SISTEM NEGATIF — Gudang opname/penyesuaian |
| BUSA-REBONDED-YL-180X200X2-D50 | SHEET | -5.00 | 77.838 | -389.190 | STOK SISTEM NEGATIF — Gudang opname/penyesuaian |
| BUSA-REBONDED-SKY-120X200X14-D70 | SHEET | -1.00 | 417.715 | -417.715 | STOK SISTEM NEGATIF — Gudang opname/penyesuaian |
| BUSA-REBONDED-YL-150X190X14-D50 | PCS | -1.00 | 478.800 | -478.800 | STOK SISTEM NEGATIF — Gudang opname/penyesuaian; SATUAN BUSA = PCS (rekan sejenis SHEET) — cek satuan |
| BUSA-REBONDED-YL-180X200X14-D50 | SHEET | -1.00 | 579.700 | -579.700 | STOK SISTEM NEGATIF — Gudang opname/penyesuaian |
| BUSA-REBONDED-YL-190X190X14-D50 | SHEET | -1.00 | 657.020 | -657.020 | STOK SISTEM NEGATIF — Gudang opname/penyesuaian |
| BUSA-REBONDED-YL-120X200X2-D50 | SHEET | -14.00 | 62.400 | -873.600 | STOK SISTEM NEGATIF — Gudang opname/penyesuaian |
| LEM-I-SR-1037-13-KG | CAN | -41.50 | 49.950 | -2.072.925 | STOK SISTEM NEGATIF — Gudang opname/penyesuaian |
| BUSA-REBONDED-YL-170X190X14-D50 | PCS | -4.00 | 542.640 | -2.170.560 | STOK SISTEM NEGATIF — Gudang opname/penyesuaian; SATUAN BUSA = PCS (rekan sejenis SHEET) — cek satuan |
| PLASTIK-PE | KG | -57.10 | 69.930 | -3.993.003 | STOK SISTEM NEGATIF — Gudang opname/penyesuaian |
| LIST-WIBING-COKLAT | ROLL | -116.50 | 94.350 | -10.991.775 | STOK SISTEM NEGATIF — Gudang opname/penyesuaian; QTY ROLL sangat besar — kemungkinan satuan meter/pack |
| LIST-WIBING-PUTIH | ROLL | -360.00 | 94.350 | -33.966.000 | STOK SISTEM NEGATIF — Gudang opname/penyesuaian; QTY ROLL sangat besar — kemungkinan satuan meter/pack |
| LIST-WIBING-ABU | ROLL | -388.50 | 94.350 | -36.654.975 | STOK SISTEM NEGATIF — Gudang opname/penyesuaian; QTY ROLL sangat besar — kemungkinan satuan meter/pack |

Material aktif lain (221 tanpa pergerakan stok) tetap wajib dihitung fisik; qty 0 boleh dicatat tanpa harga/sumber.
