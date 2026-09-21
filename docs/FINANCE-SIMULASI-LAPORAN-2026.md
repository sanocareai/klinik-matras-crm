# Simulasi laporan Januari–September 2026 (disanitasi; SIMULASI — tidak memengaruhi produksi)

Dokumen ini berisi metodologi dan angka agregat tanpa nama pelanggan. Rincian transaksi disimpan di luar Git (SANO-PRIVATE). **Semua angka di bawah adalah SIMULASI**: tidak ada jurnal, saldo, atau data produksi yang diubah. Pendapatan 2026 masih dalam proses rekonsiliasi data sebelum sistem dan backfill order. Angka belum final.

## 1. Metodologi
- **S1 — Buku saat ini:** laporan laba rugi dari jurnal yang sudah dibukukan (fungsi laporan yang sama dengan Finance Workspace) per bulan.
- **S2 — Setelah backfill order sistem yang valid:** S1 + pendapatan 298 order selesai/diserahterimakan dengan bukti tanggal pengiriman, dialokasikan ke **bulan serah-terima masing-masing** (bukan bulan order dibuat, bukan semuanya ke September). HPP dan beban tidak diubah (sudah ada di buku). Kas & Bank tidak berubah; bagian yang sudah dibayar sebelum pembayaran dicatat memakai lawan ekuitas non-kas (3-4100).
- **S3 — YTD setelah migrasi historis yang valid:** S2 + penerimaan Notion sebelum 12 Jul yang **eksplisit** berjenis Pembayaran/Pelunasan pelanggan atau penjualan barang lain (batas atas berbasis penerimaan kas). Tidak termasuk: DP, transfer/penarikan, modal, pinjaman, Balance/pelunasan piutang lama, penyesuaian, tak terklasifikasi. Penerimaan Notion setelah 12 Jul TIDAK dihitung (periode itu = order sistem).
- Ini bukan laporan final: pendapatan historis berbasis kas (bukan serah-terima), akun pendapatan historis belum dipetakan, dan 50 order selesai tanpa bukti tanggal serta 68 order berjalan tidak dimasukkan.

## 2. Laba bersih sementara per bulan — sebelum dan sesudah simulasi
| Bulan | S1 Buku saat ini | S2 + backfill order valid | S3 + migrasi historis valid | Tambahan backfill | Tambahan historis |
|---|---:|---:|---:|---:|---:|
| Jan | −Rp69.101.071 | −Rp69.101.071 | −Rp13.091.571 | Rp0 | Rp56.009.500 |
| Feb | −Rp120.261.486 | −Rp120.261.486 | −Rp4.904.986 | Rp0 | Rp115.356.500 |
| Mar | −Rp146.397.117 | −Rp146.397.117 | −Rp20.331.037 | Rp0 | Rp126.066.080 |
| Apr | −Rp279.080.844 | −Rp279.080.844 | −Rp37.505.844 | Rp0 | Rp241.575.000 |
| Mei | −Rp362.519.000 | −Rp362.519.000 | Rp2.999.250 | Rp0 | Rp365.518.250 |
| Jun | −Rp415.001.417 | −Rp415.001.417 | Rp31.556.583 | Rp0 | Rp446.558.000 |
| Jul | −Rp446.990.400 | −Rp268.749.900 | −Rp58.095.900 | Rp178.240.500 | Rp210.654.000 |
| Agu | −Rp482.770.592 | −Rp57.061.592 | −Rp57.061.592 | Rp425.709.000 | Rp0 |
| Sep | −Rp269.668.290 | −Rp129.002.290 | −Rp129.002.290 | Rp140.666.000 | Rp0 |
| **YTD** | **−Rp2.591.790.217** | **−Rp1.847.174.717** | **−Rp285.437.387** | Rp744.615.500 | Rp1.561.737.330 |

Komponen S1 (buku saat ini):

| Bulan | Pendapatan (buku) | HPP | Laba kotor | Beban operasional | Laba bersih sementara | Kumulatif |
|---|---:|---:|---:|---:|---:|---:|
| Jan | Rp0 | Rp31.266.466 | −Rp31.266.466 | Rp37.834.605 | −Rp69.101.071 | −Rp69.101.071 |
| Feb | Rp0 | Rp47.152.228 | −Rp47.152.228 | Rp73.109.258 | −Rp120.261.486 | −Rp189.362.557 |
| Mar | Rp0 | Rp57.519.256 | −Rp57.519.256 | Rp88.877.861 | −Rp146.397.117 | −Rp335.759.674 |
| Apr | Rp0 | Rp146.895.690 | −Rp146.895.690 | Rp132.185.154 | −Rp279.080.844 | −Rp614.840.518 |
| Mei | Rp0 | Rp157.915.674 | −Rp157.915.674 | Rp204.603.326 | −Rp362.519.000 | −Rp977.359.518 |
| Jun | Rp40.422.000 | Rp263.212.993 | −Rp222.790.993 | Rp192.210.424 | −Rp415.001.417 | −Rp1.392.360.935 |
| Jul | Rp40.422.000 | Rp180.005.463 | −Rp139.583.463 | Rp307.406.937 | −Rp446.990.400 | −Rp1.839.351.335 |
| Agu | Rp15.937 | Rp199.878.845 | −Rp199.862.908 | Rp282.907.684 | −Rp482.770.592 | −Rp2.322.121.927 |
| Sep | Rp64.705.755 | Rp130.338.525 | −Rp65.632.770 | Rp204.035.520 | −Rp269.668.290 | −Rp2.591.790.217 |
| **YTD** | **Rp145.565.692** | **Rp1.214.185.140** |  | **Rp1.523.170.769** | **−Rp2.591.790.217** |  |

Catatan pembacaan: laba/rugi buku Januari–Mei (≈ −Rp977 juta) negatif karena **biaya sudah dibukukan sejak Januari sementara pendapatan baru dibukukan sejak 17 Sep** — kerugian buku YTD sebagian besar adalah artefak pendapatan yang belum masuk, bukan hasil usaha yang final. S3 tetap negatif (−Rp285.437.387) sehingga klasifikasi HPP/beban perlu ditinjau terpisah (mis. pembelian aset/bahan yang mungkin tidak seharusnya HPP).

## 3. Penerimaan Notion per bulan — tidak seluruhnya pendapatan
| Bulan | Pembayaran/Pelunasan pelanggan | Penjualan barang lain | DP / uang muka | Transfer/penarikan | Modal | Pinjaman | Balance / pelunasan piutang lama | Penyesuaian/selisih | Tidak terklasifikasi | Invalid | Tanpa jenis — cocok order (Sedang) | Tanpa jenis — cocok order (Rendah) | Tanpa jenis — tanpa kandidat order | Total |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Jan (sebelum sistem) | Rp56.009.500 | — | — | Rp900.000 | — | Rp17.950.000 | — | Rp0 | Rp1.950.000 | — | — | — | — | Rp76.809.500 |
| Feb (sebelum sistem) | Rp114.756.500 | Rp600.000 | Rp1.620.000 | — | Rp5.000.000 | — | — | Rp835.845 | — | — | — | — | — | Rp122.812.345 |
| Mar (sebelum sistem) | Rp126.066.080 | — | Rp6.980.000 | — | — | — | — | — | — | — | — | — | — | Rp133.046.080 |
| Apr (sebelum sistem) | Rp241.575.000 | — | Rp1.998.000 | — | — | — | — | — | — | — | — | — | — | Rp243.573.000 |
| Mei (sebelum sistem) | Rp365.518.250 | — | Rp9.057.001 | — | — | — | — | — | — | — | — | — | — | Rp374.575.251 |
| Jun (sebelum sistem) | Rp444.558.000 | Rp2.000.000 | Rp33.059.000 | — | — | — | Rp40.422.000 | — | Rp4.175.000 | Rp0 | — | — | — | Rp524.214.000 |
| Jul (1–11) | Rp210.654.000 | — | Rp500.000 | — | — | — | — | — | Rp400.000 | — | — | — | — | Rp211.554.000 |
| Jul (12–31) | Rp221.759.000 | — | Rp9.990.000 | — | — | — | — | — | — | — | — | Rp1.390.000 | Rp1.150.000 | Rp234.289.000 |
| Agu (overlap) | Rp440.678.500 | — | Rp18.327.000 | — | — | — | — | Rp15.937 | — | — | Rp200.000 | — | Rp2.800.000 | Rp462.021.437 |
| Sep (overlap) | Rp141.621.000 | — | Rp3.340.000 | — | — | — | — | — | — | — | Rp54.920.000 | Rp27.650.000 | — | Rp227.531.000 |

Kelas ditentukan dari bukti teks/kategori Notion; pada periode overlap, baris berconfidence **Tinggi** terhadap order diklasifikasi Pembayaran/Pelunasan. Yang berjenis "tanpa jenis" tidak diklasifikasi (tidak ditebak).

## 4. Alokasi 298 order selesai ke bulan serah-terima
| Bulan serah-terima | Order | Pendapatan | 4-1100 | 4-1200 | 4-1300 | 4-1900 | Lawan 3-4100 (lunas tanpa pembayaran) | Lawan piutang 1-1300 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Jul | 69 | Rp178.240.500 | Rp152.620.500 | Rp25.420.000 | Rp200.000 | Rp0 | Rp178.240.500 | Rp0 |
| Agu | 173 | Rp425.709.000 | Rp379.245.000 | Rp44.314.000 | Rp2.000.000 | Rp150.000 | Rp425.709.000 | Rp0 |
| Sep | 56 | Rp140.666.000 | Rp121.065.000 | Rp19.501.000 | Rp100.000 | Rp0 | Rp130.776.000 | Rp9.790.000 |

Bulan order dibuat → bulan serah-terima (jumlah order): dibuat Jul → serah-terima Jul 69, Agu 51; dibuat Agu → Agu 122, Sep 24; dibuat Sep → Sep 32. Jadi tidak semua masuk September; 75 order berpindah bulan.

## 5. Hubungan 298 order belum diakui × 343 order lunas tanpa Payment × Notion confidence tinggi
Himpunan: **A** = 298 order layak diakui; **B** = 343 order lunas di CRM tanpa Payment (yang melunasi); **C** = 148 order yang dijelaskan penerimaan Notion confidence Tinggi; **D** = 30 order yang sudah diakui.

| Hubungan | Order | Nilai |
|---|---:|---:|
| A | 298 | Rp744.615.500 |
| B | 343 | Rp853.775.000 |
| C | 148 | Rp412.784.000 |
| A ∩ B (backfill dengan lawan ekuitas non-kas) | 293 | Rp734.725.500 |
| A ∩ B ∩ C (ada penerimaan Notion Tinggi) | 121 | Rp350.694.000 |
| A ∩ B tanpa Notion Tinggi | 172 | Rp384.031.500 |
| A tanpa B (belum lunas → piutang) | 5 | Rp9.890.000 |
| B tanpa A (lunas tetapi belum layak diakui) | 50 | Rp119.449.500 |
| — di antaranya sudah diakui (D) | 7 | Rp14.620.000 |
| — selesai tanpa bukti tanggal | 35 | Rp86.444.500 |
| — masih berjalan | 8 | Rp18.385.000 |
| A ∩ D | 0 | — |

**Risiko double counting dan cara menghindarinya**
1. **Notion ≥ 12 Jul × order:** register historis tidak menghitung baris Notion periode sistem; pendapatan periode itu hanya dari order. Jangan memigrasikan baris Notion 12 Jul–16 Sep sebagai pendapatan.
2. **Kas ganda:** 343 order lunas tanpa Payment (Rp853.775.000) sudah tercermin dalam saldo bank yang dikalibrasi. Jika seorang staf kemudian "melengkapi" pembayaran dengan mencatat Payment berrekening, jurnal kas baru menggandakan kas seperti 13 pembayaran yang dikoreksi. Bagian A∩B memakai lawan ekuitas non-kas justru untuk mencegah ini.
3. **Uang muka tanpa kewajiban:** 50 order lunas yang belum layak diakui (Rp119.199.500) uangnya sudah dalam saldo (lewat kalibrasi → ekuitas), tetapi kewajiban Uang Muka Pelanggan (2-1200) belum ada di buku. Pengakuan saat serah-terima nanti tidak akan menemukan uang muka untuk dipindahkan (piutang akan tercatat penuh, padahal sudah dibayar).
4. **Tujuh order sudah diakui tetapi berstatus lunas tanpa Payment** (Rp14.620.000): piutangnya tercatat di buku padahal CRM menyatakan lunas → piutang buku terlalu tinggi sampai dilunasi secara non-kas.
5. **Penerimaan Notion Tinggi (148 order) × Payment sistem:** hanya 2 order punya keduanya — pembayaran sistem dan penerimaan Notion untuk order itu adalah kejadian uang yang SAMA, bukan dua penerimaan.
6. **Pemasukan lain Rp40.422.000 (Jun) di buku** berasal dari kategori Notion "Balance/pelunasan piutang lama" — bukan pendapatan usaha; jangan ikut dimigrasi ulang sebagai pendapatan.

## 6. Proposal urutan posting (tidak dijalankan; butuh persetujuan Owner per tahap)
0. **Prasyarat:** rekening koran KEM/PT (cutoff baru), konfirmasi jam saldo riil, backup database, pratinjau tiap tahap, snapshot sebelum/sesudah (Kas & Bank, JV-372, JV-391, 23 koreksi, 2-1600 tidak berubah).
1. **Putuskan status order yang pengakuannya dipertanyakan** (satu order produk — lihat audit privat) sebelum tahap apa pun; jangan membalik jurnal sebelum status penyelesaian dikonfirmasi.
2. **Tahap 1 — backfill terkonfirmasi Notion:** 121 order (A∩B∩C, Rp350.694.000) yang lunas menurut CRM **dan** punya penerimaan Notion Tinggi; per order, tanggal buku = tanggal serah-terima; lawan 3-4100.
3. **Tahap 2 — backfill lunas tanpa konfirmasi Notion:** 172 order (Rp384.031.500) yang hanya berdasar status lunas CRM — tinjau bukti (bukti transfer/WA/Notion sedang) lebih dulu.
4. **Tahap 3 — order belum lunas:** 5 order (Rp9.890.000) → piutang (jalur pengakuan standar).
5. **Tahap 4 — uang muka:** 50 order lunas belum diserahterimakan → reklasifikasi non-kas Dr 3-4100 / Cr 2-1200 (agar pengakuan berikutnya memindahkan uang muka); tinjau 7 order yang sudah diakui tetapi lunas.
6. **Tahap 5 — 50 order selesai tanpa bukti tanggal:** lengkapi bukti (tanggal serah-terima) baru diakui.
7. **Tahap 6 — migrasi historis** (Jan–11 Jul): setelah Owner memutuskan pemetaan akun dan perlakuan DP (data Notion tidak memuat jenis produk); lawan 3-4100 (non-kas). Pisahkan pinjaman/modal/transfer/Balance.
8. **Tahap 7 — bersihkan klasifikasi:** Pemasukan Lain Rp40.422.000; penerimaan Notion overlap Sedang/Rendah/Tanpa kandidat.
9. Setelah setiap tahap: verifikasi Kas & Bank tidak berubah, laporan S1 → sesuai simulasi, jalankan ulang tidak menggandakan (kunci idempoten per order).
