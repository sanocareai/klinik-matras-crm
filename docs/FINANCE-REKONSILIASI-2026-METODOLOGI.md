# Rekonsiliasi Pendapatan & Rekening 2026 — metodologi dan hasil agregat (disanitasi)

Diperbarui 22 Sep 2026. Dokumen ini **hanya** memuat metodologi, hasil agregat, dan manifest artefak. Tidak memuat nama pelanggan, rincian transaksi, mutasi rekening, atau proposal jurnal per transaksi. Bukti mentah disimpan di lokasi privat di luar Git (lihat manifest: `docs/pilot/manifest-rekonsiliasi-20260921.json`).

## Status & keputusan Owner (22 Sep 2026)

- **Tidak ada jurnal produksi yang dibuat/diubah.** Jumlah jurnal 2.863 sebelum dan sesudah seluruh pekerjaan; total debit/kredit buku besar identik. Kas & Bank, JV-19092026-372, JV-21092026-391, akun 2-1600 tidak disentuh.
- **Ditangguhkan (tidak dijalankan):** proposal 298 jurnal pengakuan pendapatan, koreksi PT Sano Rp27.395.000, koreksi KEM, posting historis apa pun.
- **Rekonsiliasi bank menunggu cutoff baru** (tanggal & jam WIB) beserta rekening koran PT Sano dan KEM dari 19 Sep 2026 20.00 WIB sampai cutoff tersebut.
- **APK internal v1.1.0 menunggu reset kuota EAS (1 Okt 2026).** Keystore produksi tidak dipakai/disalin lokal. Tidak ada EAS Update/AAB.
- Peringatan UI "Pendapatan 2026 masih dalam proses rekonsiliasi data sebelum sistem dan backfill order. Angka belum final." dipertahankan (web + mobile).
- File data mentah dilarang di Git (`.gitignore` diperbarui); bukti mentah di `C:\Users\rudya\SANO-PRIVATE\finance-2026-09-21\`.

## 1. Data Sebelum Sistem (arsip Notion "Incomes")

Berkas ekspor Notion (943 baris; SHA-256 `29049dc1…56d3`) diimpor sebagai register **non-posting** (batch `e6e156d7…`). Isinya catatan uang masuk per rekening, bukan invoice/order — tanpa kolom pelanggan/nomor order/jenis. Hasil: 618 baris siap (Jan–11 Jul; Rp1.622.376.331), 305 di luar periode (12 Jul–16 Sep; Rp923.825.500; tidak dihitung), 2 perlu ditinjau, 18 bukan pendapatan/tidak valid.

> Catatan: berkas CSV Notion sudah ter-*track* di Git sejak sebelum pekerjaan ini (`backend/data/notion-data-2026/`) dan memuat nama pelanggan. Belum diubah; keputusan `git rm --cached`/pembersihan riwayat ada pada Owner.

## 2. Audit order 12 Jul – 16 Sep

Dari 458 order non-batal, 30 sudah diakui (17–21 Sep) → 428 belum. Layak diakui (selesai, tanggal pengiriman terbukti): 298 (Rp744.615.500). Selesai tanpa bukti tanggal: 50 (Rp102.294.500, Perlu Ditinjau). Berjalan: 68 (Rp140.107.000). Nilai Rp0: 12. Refund aktif: 0. Batal: 30 (di luar 458). Tanggal pengakuan = tanggal pengiriman selesai pertama; akun menurut jenis order (4-1100/4-1200/4-1300/4-1900). Simulasi (tidak dijalankan): pendapatan +Rp744,6 jt, piutang +Rp9,79 jt, Koreksi Saldo Awal −Rp734,7 jt, total ekuitas +Rp9,89 jt, saldo rekening tidak berubah. **Proposal ditangguhkan.**

## 3. Pencocokan lanjutan Notion ↔ order (12 Jul–16 Sep; 305 baris)

Kode: `backend/src/services/finance/cocokNotion.js` (murni, tanpa database; tes `backend/tests/cocokNotion.test.js`). **Hanya laporan; tidak mengubah data produksi.**

**Metode.** (a) Ekstrak nama dari "Pembayaran/Pelunasan/DP <nama>", buang tag `(…)`/`[…]`. (b) Normalisasi: huruf kecil, tanpa aksen/emoji/tanda baca, buang gelar (ibu/bapak/mba/dr/hj/an/pt…), seragamkan singkatan (M./Moh/Muh → muhammad), abaikan urutan kata. (c) Skor nama 0–1: sama = 1; token saling memuat ≈ 0,9; typo ringan ≈ 0,85. (d) Nominal: sama persis dengan nilai order (harga + ongkir); kombinasi cicilan (2–4 penerimaan berjumlah tepat satu order); satu pembayaran untuk beberapa order (kombinasi 2–3 order pelanggan sama). (e) Jendela tanggal: 3 hari sebelum order dibuat s.d. 45 hari setelah pengiriman/dibuat. (f) Rekening hanya pendukung: kolom "Accounts" Notion ambigu (sebagian "Untitled"/dua rekening) sehingga tidak dijadikan syarat.

**Confidence.** *Tinggi* = nama kuat + nominal tepat + tanggal dalam jendela + penjelasan **unik** (dan order tidak diklaim penuh oleh penerimaan lain). *Sedang* = nominal tepat tetapi tidak unik/tanggal di luar jendela/nama kurang kuat, atau nama kuat dengan nominal sebagian (DP/cicilan belum lengkap). *Rendah* = hanya nama atau hanya nominal. *Tidak ada* = tanpa kandidat. **Hanya Tinggi (unik) dianggap terjelaskan.**

| Confidence | Baris | Nilai | Rincian jenis |
|---|---:|---:|---|
| **Tinggi (terjelaskan)** | 127 | Rp412.784.000 | penuh 106, gabungan beberapa order 19, cicilan 2 |
| Sedang (Perlu Ditinjau) | 81 | Rp230.551.500 | penuh-tidak-unik 35, sebagian/DP 33, gabungan-tidak-unik 13 |
| Rendah (Perlu Ditinjau) | 77 | Rp220.302.000 | nominal saja 53, nama saja 24 |
| Tidak ada | 20 | Rp60.188.000 | 16 nama tidak ada di order sistem, 3 deskripsi lain, 1 korporat/sewa |
| **Total** | 305 | Rp923.825.500 | |

Per bulan (Tinggi/Sedang/Rendah/Tidak ada): Jul 30/13/25/10 · Agu 59/45/39/9 · Sep 38/23/13/1.

**Temuan.** 127 penerimaan Tinggi menjelaskan **148 order** — seluruhnya berstatus pembayaran LUNAS di sistem, dan jumlah penerimaan **sama persis** dengan nilai order (0 order kurang, 0 order kelebihan/dobel). Dari 23 pembayaran sistem (sejak 1 Sep), hanya 2 yang sama nominal dengan penerimaan Notion untuk order yang sama; 21 lainnya tidak ada di Notion (Notion berhenti dipakai sebagai catatan utama pada September). 365 order LUNAS non-batal: 47 (Rp96,58 jt) tanpa satu pun kandidat Notion, 19 di antaranya punya pembayaran di sistem.

## 4. Audit double counting (305 baris Notion vs order sistem)

- **Register tidak menghitung satu pun dari 305 baris** (semuanya *Di luar periode*), sehingga pendapatan historis tidak menggandakan pendapatan order sistem. Pendapatan gabungan = sistem + baris SIAP sebelum 12 Jul saja.
- Uji arah sebaliknya: baris SIAP sebelum cutoff (1 Jun–11 Jul; 212 baris) terhadap order sistem — **0** kecocokan Tinggi; 16 baris (Rp38.490.000) Sedang (mis. nominal & nama cocok tetapi tanggal jauh sebelum order) → **Perlu Ditinjau**, batas atas risiko hitung ganda pada register.
- 178 baris Notion periode sistem (Sedang/Rendah/Tidak ada; Rp511 jt) tetap Perlu Ditinjau; tidak dijurnal.
- Order berstatus LUNAS tanpa catatan pembayaran (293 dari 298 yang layak) dan penerimaan Notion Tinggi saling menguatkan bahwa uangnya diterima sebelum pembayaran dicatat di sistem — dasar asumsi "lawan ekuitas non-kas" (3-4100) pada proposal yang ditangguhkan.

## 5. Dua order sudah diakui tetapi belum selesai (bukti & proposal saja; jurnal tidak dibalik)

| Order | Bukti | Penilaian | Proposal (tidak dijalankan) |
|---|---|---|---|
| `RES-13092026-079` (layanan) | Pengiriman selesai 17 Sep; unit berstatus DELIVERED; pengakuan JV-17092026-002 dijurnal 17 Sep oleh admin keuangan sesuai serah-terima. Pada 21 Sep 11.26 status order dikunci manual ke PROCESSING (tanpa catatan) dan dibuat tugas PICKUP baru (belum dijadwalkan). | Pengakuan **sah** saat dibuat; status mundur = kemungkinan revisi/retur/komplain baru. | Pertahankan jurnal. Konfirmasi ke pengubah status apakah ini revisi (bukan retur). Jika retur/refund: gunakan alur Refund resmi (bukan membalik pengakuan). Catat alasan pada order. |
| `NEW-30082026-023` (produk) | Pengakuan JV-21092026-429 dijurnal 21 Sep 16:45:50; status order dikunci manual ke SHIPPING 2 detik kemudian (16:45:52) oleh pengguna yang sama; pengiriman masih SCHEDULED; unit READY_FOR_DELIVERY; tidak ada pengiriman selesai. | Pengakuan **prematur**: barang belum diserahterimakan (kemungkinan status sempat diset ke Delivered lalu dikoreksi ke Shipping). | Setelah persetujuan Owner: balik JV-429 lewat pembalikan resmi, lalu akui saat pengiriman selesai. **Peringatan teknis:** mesin pengakuan menganggap kunci `PENGAKUAN_PENDAPATAN:<orderId>` sudah ada walau jurnalnya dibalik; pengakuan ulang akan menjadi no-op — pembalikan harus melepaskan kunci (atau memakai sufiks koreksi) sebelum pengakuan ulang. Efek jika dibalik: pendapatan −Rp2.961.000, piutang −Rp2.961.000. |

## 6. Rekonsiliasi bank — ditangguhkan

Cutoff baru dan rekening koran belum tersedia; **selisih PT Sano dan KEM pada cutoff yang sama tidak dilaporkan** (tidak boleh membandingkan saldo dari waktu berbeda). Catatan hipotesis kerja (tidak dipakai sebagai kesimpulan): jurnal pembayaran/pengeluaran bertanggal sebelum saat saldo riil kalibrasi diambil tetapi dijurnal sesudahnya berpotensi menggandakan kas; untuk PT Sano pola ini menjelaskan 100% selisih terhadap saldo riil yang diberikan (13 jurnal), untuk KEM sebagian (sisa belum terjelaskan). Proposal koreksi per transaksi (24 baris) **dinonaktifkan**; akan disusun ulang setelah cutoff baru + mutasi bank tersedia. Dokumen kunci yang dibutuhkan: rekening koran PT Sano & KEM (19 Sep 2026 20.00 WIB → cutoff), tanggal & jam WIB cutoff.

## 7. Manifest artefak privat

Lihat `docs/pilot/manifest-rekonsiliasi-20260921.json` (nama artefak, ukuran, jumlah baris/rekord, SHA-256). Artefak sendiri **tidak** ada di Git.

## 8. Rekonsiliasi menyeluruh Notion → Order/Payment → Jurnal → saldo riil (22 Sep 2026; cutoff 19 Sep 20.00 → 21 Sep 20.00 WIB)

> **Rekonsiliasi sementara tanpa rekening koran. Saldo akhir telah dikonfirmasi owner, tetapi mutasi individual belum seluruhnya diverifikasi.**
> Baca-saja. Tidak ada jurnal, saldo, backfill pendapatan, pembalikan JV-429, atau pembersihan akun sementara. Laporan rinci (HTML, per jurnal/dokumen) disimpan privat di luar Git.

**Jembatan buku (saldo awal buku pada cutoff + mutasi buku = saldo akhir buku; cocok dengan database):** PT Sano 115.994.380 − 49.418.765 = **66.575.615**; KEM 18.116.768 − 5.334.669 = **12.782.099**; Kas 66.500 + 26.000 = **92.500**. Mutasi mencakup kalibrasi JV-372 dan JV-391.

**Jembatan riil (dua titik konfirmasi owner):** PT Sano 36.870.615 → 36.350.615 (21 Sep 10.09; −520.000) → 39.180.615 (+2.830.000). KEM 766.507 → 4.172.788 (+3.406.281) → 4.912.088 (+739.300). Kas riil awal 54.500; akhir belum dikonfirmasi (Rp120.000 tidak dipakai) → Kas tidak direkonsiliasi dan tidak termasuk selisih.

**Selisih buku − bank Rp35.265.011:**

| Rekening | Selisih | Terjelaskan (perbedaan waktu pencatatan) | Belum terjelaskan |
|---|---:|---:|---:|
| PT Sano | 27.395.000 | 27.395.000 (13 jurnal pembayaran; 22.895.000 tercermin JV-372, 4.500.000 tercermin JV-391) | 0 |
| KEM Sano | 7.870.011 | 5.343.030 (4 pembayaran +10.828.030; 6 pengeluaran/pembelian −5.485.000) | **2.526.981** |
| **Total** | **35.265.011** | **32.738.030** | **2.526.981** |

Duplikat murni, salah rekening, dan transfer antar-rekening: tidak terbukti (Rp0). Selisih **bukan** biaya dan **bukan** pendapatan. Pada interval 21 Sep 10.09 → 20.00: PT Sano 4 pembayaran bertanggal 21 Sep (9.830.000) − transfer keluar 7.000.000 = 2.830.000 = pergerakan riil (cocok tepat); KEM transfer masuk 7.000.000 − pengeluaran 21 Sep 3.733.719 = 3.266.281 vs pergerakan riil 739.300 (beda 2.526.981).

**Penerimaan Notion 618 baris sebelum sistem (Rp1.622.376.331) — penerimaan historis, bukan otomatis pendapatan:** penerimaan pelanggan eksplisit ("Pembayaran/Pelunasan") 587 baris Rp1.559.137.330; penjualan barang lain 2 baris Rp2.600.000; uang muka "DP" 23 baris Rp53.214.001; transfer/penarikan 1 baris Rp900.000 (**tercatat SIAP karena kategori kosong — bukan pendapatan**); tak terklasifikasi 5 baris Rp6.525.000. Di luar 618 (sudah dikeluarkan): pinjaman 8 (Rp17.950.000), suntikan modal 1 (Rp5.000.000), balance/penyesuaian 3 (Rp41.257.845), invalid 2. Tidak ada baris refund. **Estimasi pendapatan hanya dari baris berbukti cukup (penerimaan pelanggan eksplisit + penjualan barang): 589 baris, Rp1.561.737.330 — batas atas berbasis penerimaan kas**, bukan pengakuan pada serah-terima.

**Laporan bulanan (agregat):**

| Bulan | Penerimaan Notion | Pendapatan order layak diakui | Pembayaran sistem | Pendapatan sudah di jurnal | Pembayaran di jurnal |
|---|---:|---:|---:|---:|---:|
| Jan | 58.859.500 | 0 | 0 | 0 | 0 |
| Feb | 116.976.500 | 0 | 0 | 0 | 0 |
| Mar | 133.046.080 | 0 | 0 | 0 | 0 |
| Apr | 243.573.000 | 0 | 0 | 0 | 0 |
| Mei | 374.575.251 | 0 | 0 | 0 | 0 |
| Jun | 483.792.000 | 0 | 0 | 0 | 0 |
| Jul | 445.843.000 (1–11: 211.554.000; 12–31: 234.289.000) | 69 order · 178.240.500 | 0 | 0 | 0 |
| Agu | 462.005.500 | 173 order · 425.709.000 | 0 | 0 | 0 |
| Sep (≤16 Notion) | 227.531.000 | 56 order · 140.666.000 | 23 · 50.883.030 | 64.696.000 (30 pengakuan, sejak 17 Sep) | 48.053.030 |

Belum masuk jurnal: seluruh penerimaan historis Jan–11 Jul (non-posting), pendapatan layak Jul–Sep (Rp744.615.500), dan 2 pembayaran Rp2.830.000. Potensi double counting: baris Notion ≥12 Jul tidak dihitung sebagai pendapatan (aman); 16 baris arsip Jun–Jul (Rp38.490.000) mirip order sistem → Perlu Ditinjau. Perlu Ditinjau lain: 50 order tanpa bukti tanggal (Rp102.294.500), 178 baris Notion overlap Sedang/Rendah/Tanpa kandidat.

**Notion lama vs Finance Workspace:** Notion mencatat penerimaan Rp2.546.201.831 (1 Jan–16 Sep); Finance Workspace mengakui pendapatan hanya Rp64.696.000 (sejak 17 Sep), pembayaran Rp50.883.030 (sejak 1 Sep), pemasukan lain Rp40.437.937, dana modal/pinjaman Rp22.950.000 — **modal+pinjaman Notion 2026 (Rp22.950.000) sama persis dengan dana masuk di buku**. Rp40.422.000 dari pemasukan lain di buku berasal dari kategori Notion "Balance" ("pelunasan piutang" Jan–Jun): bukan pendapatan usaha → Perlu Ditinjau. Angka kedua sistem tidak boleh dijumlahkan.

**NEW-30082026-023:** diperlakukan sebagai order sistem; JV-429 tidak dibalik. Proposal pembalikan hanya setelah status penyelesaian/serah-terima dikonfirmasi.

**Proposal koreksi (24 baris, non-kas, lawan 3-4100)** tetap **ditangguhkan** dan tidak diposting; menunggu rekening koran + persetujuan Owner. Sisa Rp2.526.981 tidak diberi entri.

## 9. Posting koreksi kas ganda (persetujuan Owner 22 Sep 2026)

Owner menyetujui koreksi bagian yang **sudah terjelaskan** (Rp32.738.030). Dieksekusi dengan `backend/scripts/koreksiKasGanda20260922.js` (daftar transaksi PRIVAT, tidak di Git): backup database lebih dulu, pratinjau, lalu `--apply` dalam satu transaksi DB (semua-atau-tidak-sama-sekali), idempoten (`KOREKSI_KAS_GANDA:<id jurnal asli>`).

- **23 jurnal** `JV-21092026-436 … JV-21092026-458` (sumber SALDO_AWAL, tanggal buku 21 Sep 2026), satu per transaksi, **non-kas** dengan lawan 3-4100: pembayaran ganda → Dr 3-4100 / Cr rekening; pengeluaran ganda → Dr rekening / Cr 3-4100. Jurnal asli tidak diubah.
- **Hasil:** PT Sano Rp66.575.615 → **Rp39.180.615** (= saldo bank akhir; selisih 0). KEM Rp12.782.099 → **Rp7.439.069** (bank Rp4.912.088; **sisa Rp2.526.981 tidak dikoreksi** — menunggu rekening koran).
- **Item Kas (Rp12.000) tidak diposting**: di luar angka Rp32.738.030 dan saldo Kas akhir belum dikonfirmasi (24 usulan → 23 diposting).
- **Verifikasi pasca-posting:** jumlah jurnal 2.863 → 2.886 (+23); saldo per rekening sama dengan harapan; buku besar seimbang; JV-372 dan JV-391 utuh; baris akun 2-1600 tidak berubah (68); posting ulang ditolak (idempoten).
- Backup sebelum posting: `klinik_matras_backup_2026-09-22_01-48-38.sql.gz` (server + Google Drive).

## 10. Modul Rekonsiliasi Bank — periode sementara (22 Sep 2026)

Hasil rekonsiliasi sementara kini tampil di UI Rekonsiliasi Bank sebagai dua periode produksi 19–21 Sep 2026 (PT Sano dan KEM Sano) berstatus **DRAF_MENUNGGU_MUTASI**. Tidak ada jurnal, saldo, atau baris mutasi bank yang dibuat.

- **Schema (aditif, kompatibel):** nilai enum `DRAF_MENUNGGU_MUTASI` pada `FinReconStatus`; kolom `cutoff_start_at`, `cutoff_end_at`, `source_key` (unik → idempotensi) pada `fin_bank_statements`. Migrasi `20260922090000_fin_bank_recon_draft`. Periode lama tidak berubah.
- **Aturan penyelesaian diperketat (satu tempat: `services/finance/rekonBank.js`):** periode hanya SELESAI bila statusnya DRAFT, ada mutasi bank asli, semua baris dicocokkan/dijelaskan, dan selisih nol. Sebelumnya endpoint boleh menutup periode tanpa mutasi atau dengan selisih hanya dengan catatan.
- **Penyesuaian Buku:** jurnal bersumber SALDO_AWAL (kalibrasi JV-372/391 dan 23 koreksi kas ganda JV-21092026-436…458) ditampilkan terpisah, bukan transaksi bank; tidak menjadi kandidat pencocokan dan ditolak bila dicoba dipasangkan dengan mutasi koran.
- **Transisi:** begitu mutasi bank asli pertama dimasukkan, periode berubah dari DRAF_MENUNGGU_MUTASI menjadi DRAFT (sedang dicocokkan).
- **Ringkasan:** butir "Selisih KEM" menaut langsung ke periode KEM (`/finance/reconciliation?periode=<id>`).
- Belum ada impor massal rekening koran (CSV/tempel); baris dimasukkan satu per satu lewat UI yang ada.
