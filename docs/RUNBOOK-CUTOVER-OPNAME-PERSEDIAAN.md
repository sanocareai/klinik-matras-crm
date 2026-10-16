# Runbook — Cutover Persediaan Gudang SANSS berbasis Opname Fisik Baru

Untuk: Kepala Gudang, Finance, Owner, dan Tech yang menjalankan cutover.
Status dokumen: SIAP DIPAKAI untuk pilot; **belum ada** posting, adjustment, atau perubahan stok di production.
Pembuatan: 15 Okt 2026. Data production per cut-off 14 Okt 21:59 UTC (live da68a2a8) — angka di dokumen ini harus dicek ulang sebelum hitung.

## 0. Prinsip (tidak boleh dilanggar)

1. **Saldo dasar = hitung fisik baru.** File stok/pemakaian manual Januari–September hanyalah referensi investigasi. Tidak dipakai sebagai saldo, tidak diposting, dan 242 order lama **tidak direkonstruksi** tanpa bukti per transaksi.
2. **Kolom kosong bukan nol.** Nol fisik wajib status `NOL_FISIK` + pemeriksa + bukti. Baris yang belum disentuh tetap `BELUM_DIHITUNG`.
3. **Selisih dihitung terhadap ledger pada waktu hitung yang sama**, bukan saldo hari ini. Penerimaan/pemakaian setelah hitung tidak boleh menghapus atau menciptakan selisih.
4. **Kuantitas dan nilai direkonsiliasi terpisah.** Harga hanya dari dokumen Finance (faktur/tagihan/pembelian). Harga sheet lama dan harga referensi master bukan nilai buku.
5. **Pisahkan** GR tertunda, staging Issue, barang dalam perjalanan, sisa di lantai produksi, dan barang milik customer — masing-masing satu kolom, supaya tidak dihitung ganda.
6. **Pemisahan tugas.** Penghitung ≠ pemeriksa. Pengaju adjustment ≠ penyetuju. Yang menyelesaikan Stock Count dengan selisih ≠ pembuat/penugas/pengisi hitungan.
7. **Naik dan turun dilaporkan terpisah; tidak di-offset.**
8. **Semua langkah di dokumen ini adalah dry-run** sampai gerbang Go/No-Go (bagian 2) dan keputusan Owner (bagian 9) terpenuhi.

## 1. Peran

| Peran | Siapa (rekomendasi) | Tugas | Hak sistem |
|---|---|---|---|
| Penghitung 1 & 2 | Staf Gudang | Menghitung buta, mengisi lembar hitung | — (kertas/Excel) |
| Pemeriksa Gudang | Orang Gudang lain dari penghitung | Menghitung ulang/menyaksikan, mengisi kolom Pemeriksa | `inventory:write` (WAREHOUSE) |
| Pencatat log jendela | Satu orang | Mencatat semua pergerakan selama jendela hitung | — |
| Pengaju adjustment | Gudang | Membuat Stock Adjustment dari rencana | `inventory:write` |
| Penyetuju | Owner atau Finance, orang lain dari pengaju | Menyetujui adjustment | `inventory:adjustment_approve` (OWNER, FINANCE) |
| Pemeriksa Finance | Finance | Mencocokkan harga ke dokumen | `finance:approve` |
| Posting persediaan awal | Owner | Posting jurnal PERSEDIAAN_AWAL | Owner + PIN Finance |
| Tech | — | Backup, rilis kode, menjalankan preview | akses VPS |

Catatan kondisi production (15 Okt): hanya **satu** akun berperan WAREHOUSE; 9 akun memegang `inventory:write`. Pemeriksa independen belum tersedia → ini gerbang Go/No-Go.

## 2. Gerbang Go/No-Go

Sebelum **pilot**: butir 1–4. Sebelum **hitung penuh**: semua.

| # | Syarat | PJ |
|---|---|---|
| 1 | Patch pemisahan tugas (kode) live; backup + tag rollback tercatat (bagian 8) | Tech |
| 2 | ≥ 2 orang berperan WAREHOUSE (penghitung & pemeriksa berbeda) | Owner/Admin |
| 3 | ≥ 2 orang penyetuju (OWNER/FINANCE) berbeda dari pengaju; PIN Finance Owner terpasang | Owner |
| 4 | Dokumen tertunda ditangani (bagian 3.3) | Gudang + Finance |
| 5 | Owner menetapkan tanggal cutover baru (bagian 9, keputusan 1) | Owner |
| 6 | Pilot lulus (bagian 4) | Gudang |
| 7 | Finance memegang harga per satuan bersumber dokumen untuk material berstok | Finance |
| 8 | Zona, label rak, log jendela, pelatihan selesai | Kepala Gudang |
| 9 | Backup + restore uji + checksum | Tech |

Daftar yang sama ada di `Rekonsiliasi-Gudang-Finance-TERTUTUP.xlsx` › *Gerbang Go-NoGo*.

## 3. Persiapan (H-7 s.d. H-1)

### 3.1 Tanggal & Pengaturan Finance
Pengaturan Finance masih `inventory_perpetual_cutover_date = 2026-10-01` dan ada snapshot **PSA-30092026-001** (DRAFT, 0 baris, cutover 1 Okt, countedAt 30 Sep 23:59 WIB). Karena opname baru dilakukan setelah tanggal itu:
1. Owner memutuskan tanggal cutover baru. **Rekomendasi: hitung 31 Okt 2026, cutover 1 Nov 2026** (opsi geser yang sudah tertulis di gerbang B3.6.2).
2. Batalkan draf lama dan buat draf baru untuk tanggal baru (Finance › Pembukuan › Tutup Stok & Persediaan Awal). Jangan mengubah tanggal setelah ada jurnal pembuka diposting.
3. `countedAt` snapshot = akhir hari sebelum cutover (WIB). Pastikan **seluruh baris hitung selesai ≤ waktu ini** atau pergerakan setelahnya tercatat di log.

### 3.2 Master dan satuan
Buka `Rekonsiliasi-Gudang-Finance-TERTUTUP.xlsx` › *Keputusan per barang*, filter kolom *Temuan otomatis* berisi `[MASTER]`, `NEGATIF`, atau `NONAKTIF`. Perbaiki master/satuan **sebelum** hitung; jangan menghitung dalam satuan yang berbeda dari master.

### 3.3 Dokumen tertunda (jangan dihitung ganda)
Saat cut-off 14 Okt: GR-091026-01 (DRAFT, tanpa baris), GR-091026-02 (siap putaway, tanpa baris), GR-141026-01 (siap putaway, 7 baris), PO terkait. Untuk tiap dokumen pilih **satu**:
- Putaway/selesaikan **sebelum** hitung → barang masuk ledger dan dihitung di rak; atau
- Biarkan tertunda → barang dihitung **hanya** di kolom *GR sudah datang, belum diposting*.

Material Issue berstatus APPROVED/READY_TO_PICK/PICKED: posting Issue sebelum hitung, atau hitung barang yang sudah diambil di kolom *Staging Issue* (tetap milik SANO selama Issue belum diposting).

### 3.4 Zona, label, jendela
- Bagi gudang per zona (kode lokasi sistem: RAW-MATERIAL, RECEIVING, WIP, QUARANTINE, DAMAGED, RETURN, FINISHED-GOODS, DISPATCH). Tiap zona dihitung dalam satu sesi ≤ 12 jam.
- Pasang label "SUDAH DIHITUNG — tanggal/jam/inisial".
- **Pembekuan** (disarankan): tidak ada penerimaan, Issue, transfer, atau adjustment dari mulai hitung hingga adjustment diposting. Bila tidak bisa dibekukan, **setiap** pergerakan yang terjadi selama hitung ditandai penghitung: sudah atau belum masuk hitungan fisik.
  - **Di aplikasi (Stock Count):** saat Start, sistem merekam snapshot saldo dan waktu mulai (tanpa pengaturan apa pun). Detail count menampilkan pergerakan ledger sesudahnya; penghitung menandai tiap pergerakan *Sudah masuk hitungan fisik* / *Belum masuk hitungan*. Sistem tidak menebak: Complete ditolak (409) selama ada yang belum ditandai. Selisih = hitung − (snapshot + pergerakan yang ditandai sudah masuk).
  - **Di lembar Excel:** sheet *Log pergerakan jendela* (dokumen, material, qty, waktu, YA/TIDAK). Preview dapat membaca tanda aplikasi dengan `--stock-count <No. Count>`.
- Catat nomor dokumen terakhir sebelum hitung di sheet *Sesi*.

### 3.5 Lembar
- `Lembar-Hitung-PILOT.xlsx` (12 material) dan `Lembar-Hitung-PENUH.xlsx` (363 material): **buta** — tidak ada saldo, harga, atau file lama.
- `Rekonsiliasi-Gudang-Finance-TERTUTUP.xlsx`: hanya Gudang lead + Finance + Owner. Jangan dibagikan ke penghitung.
- Dibuat ulang sebelum hari-H dari data terbaru (skrip: `backend/src/services/opnameLembar.js`).

## 4. Pilot (12 material)

Tujuan: membuktikan pola yang sama sebelum seluruh material. Pilihan (alasan lengkap di *Rekonsiliasi › Pilot*):

| Peran | Material | Menguji |
|---|---|---|
| A. Aktif dipakai, dokumen bersih (6) | KAIN-LAVA-B-GRADE, KAIN-TABENG-HIKARON-IVONNA-247-SILVER, BUSA-SOFT-FOAM-35SS-SKY-160X200X2, PE-ENCASEMENT-195X14X4-MBB, COT-001, BUSA-ROLL-HR-FOAM-120X1CM-N37 | alur penuh, selisih terhadap ledger saat hitung |
| B. Stok diam (2) | SAKURA-HITAM-6CM, SUDUT-GOLD | saldo lama tanpa pemakaian |
| C. GR tiba belum diposting | LIST-WIBING-ABU | kolom GR terpisah; **jebakan satuan**: master ROLL, pemakaian lama dalam METER → ledger −388,5 (hitung dalam ROLL) |
| D. Ledger negatif | LEM-I-SR-1037-13-KG | fisik dihitung apa adanya; **jebakan satuan**: master CAN (kaleng 13 KG), bukan KG |
| E. Ledger nol tetapi dipakai | BUSA-REBONDED-OLYMPIC-160X200X2-D50 | `NOL_FISIK` eksplisit |
| F. Punya nilai buku Finance | BUSA-ROLL-HR-FOAM-120X1CM-N44 | rekonsiliasi nilai terpisah (Rp9.961.200 dari GR-091026-03); baseline ledger ≠ QTY AUG file lama |

Langkah: hitung → isi lembar → jalankan preview (bagian 6) → Gudang + Finance meninjau.
**Pilot lulus** bila: tidak ada BLOCKER; semua nol fisik punya bukti & pemeriksa; pergerakan jendela terpetakan; kolom GR/Issue sesuai dokumen; Finance dapat menetapkan harga dari dokumen untuk material berstok; waktu hitung per material tercatat. Selisih besar **tidak** menggagalkan pilot — ia dibahas, bukan dihapus.

## 5. Hari hitung penuh

1. **Pembukaan.** Isi sheet *Sesi*. Konfirmasi pembekuan atau penunjukan pencatat log. Cetak log dokumen terakhir.
2. **Hitung buta.** Dua orang per zona; satu menghitung, satu mencatat. Tidak boleh melihat saldo sistem atau file lama.
3. **Pisahkan saat menghitung:** rak milik SANO · staging Issue · GR tiba belum diposting · dalam perjalanan · sisa di lantai produksi · milik customer. Barang yang tidak jelas kepemilikannya → kolom *Catatan*, jangan ditebak.
4. **Nol fisik:** cari di semua lokasi, foto rak/label kosong, isi status `NOL_FISIK`, angka 0, bukti; pemeriksa menandatangani.
5. **Pemeriksa** menghitung ulang atau menyaksikan; isi nama. Selisih ke ledger bukan urusan penghitung.
6. **Waktu** mulai & selesai per baris (WIB). Lebih dari 12 jam → pecah.
7. **Log jendela.** Setiap pergerakan selama jendela dicatat segera; satu orang pemegang.
8. **Penutupan sesi.** Sheet *Sesi* lengkap, lembar dikumpulkan dalam satu berkas, foto bukti diberi nomor.

## 6. Preview selisih (dry-run)

```bash
# salin lembar terisi ke container, lalu (di folder release aktif)
docker compose cp Lembar-Hitung-terisi.xlsx backend:/tmp/opname.xlsx
docker compose exec -T backend node scripts/opname-preview.mjs \
  --file /tmp/opname.xlsx --out /tmp/preview-opname \
  --cutoff "2026-10-31 23:59" --saldo-1400-sampai 2026-10-31
docker compose cp backend:/tmp/preview-opname ./preview-opname
```

Sifat skrip: seluruh akses DB dalam satu transaksi `READ ONLY` (Postgres menolak tulis); tidak ada opsi `--apply` (menolak dengan exit 2); tidak membuat dokumen. Tes: `tests/opnameCutover.test.js`, `tests/integration/opnameCutover.integration.test.js`.

Keluaran: `preview.json`, `preview.xlsx`, `rencana-adjustment.csv`.

Cara membaca *Status akhir* per material:

| Status | Arti | Tindakan |
|---|---|---|
| SESUAI | fisik = ledger saat hitung | tidak ada |
| SELISIH_KECIL | ≤ 2% saldo (min 1 satuan) | bukti wajib; adjustment bila disetujui |
| SELISIH_BESAR | di atas ambang | hitung ulang oleh pemeriksa, bukti, keputusan Gudang + Finance |
| NOL_FISIK_LEDGER_POSITIF | fisik 0, ledger positif | cari ulang di semua lokasi; keputusan Gudang + Finance |
| LEDGER_NEGATIF | ledger negatif saat hitung | penyebab dicari (GR/pembelian tak masuk); adjustment menaikkan ke fisik |
| PERLU_HITUNG_ULANG | ada BLOCKER | perbaiki lembar; tidak masuk rencana adjustment |
| BELUM_DIHITUNG | tak ada angka | bukan nol — hitung |

BLOCKER umum: `KOSONG_BUKAN_NOL`, `NOL_HARUS_EKSPLISIT`, `NOL_TANPA_BUKTI`, `PEMERIKSA_SAMA_DENGAN_PENGHITUNG`, `WAKTU_TIDAK_LENGKAP`, `SATUAN_BEDA`, `PERGERAKAN_JENDELA_TAK_TERCATAT`, `LOG_TANPA_KEPUTUSAN`, `DUPLIKAT_LOKASI`, `SELISIH_TANPA_BUKTI`, `CUTOFF_SEBELUM_SELESAI`.

*Pergerakan di jendela* menampilkan pergerakan ledger selama hitung beserta tanda penghitung. Jalur cepat penerimaan/retur/buang sudah **ditutup permanen** (410), sehingga setiap pergerakan baru berdokumen dan berpelaku.

### 6.1 Rekonsiliasi nilai (terpisah)
Isi sheet *Harga Finance* (kode, harga per satuan, sumber FAKTUR/TAGIHAN/PEMBELIAN/LAINNYA, nomor dokumen; LAINNYA wajib keterangan). Preview menghitung nilai **hanya** untuk material berharga sah dan menandai `NILAI_BELUM_DITETAPKAN` untuk sisanya. Penyesuaian jurnal = nilai fisik − saldo 1-1400 (formula yang sama dengan modul Tutup Stok). Per 14 Okt: saldo 1-1400 = Rp25.558.000 (6 baris GR 9 & 13 Okt), tabel penilaian kosong, snapshot 0 baris — penyesuaian awal akan ≈ seluruh nilai fisik.

## 7. Keputusan Gudang + Finance per barang

Satu baris per material di *Keputusan per barang* (363 baris; tahap: PILOT 12 · GELOMBANG_1 142 · GELOMBANG_2 194 · NONAKTIF 15). Isi kolom *KEPUTUSAN GUDANG* dan *KEPUTUSAN FINANCE* dengan satu dari:

| Gudang | Finance |
|---|---|
| TERIMA_FISIK (angka hitung dipakai) | HARGA_DITETAPKAN (sebut dokumen) |
| HITUNG_ULANG (alasan) | HARGA_MENUNGGU_DOKUMEN |
| PERBAIKI_MASTER (apa) | TOLAK_HARGA (alasan) |
| NONAKTIFKAN (fisik 0, tidak dipakai) | BEBANKAN_SELISIH (sesuai kebijakan akurasi) |

Aturan: tidak ada adjustment untuk baris yang Gudang-nya bukan TERIMA_FISIK; tidak ada snapshot untuk baris berstok yang Finance-nya bukan HARGA_DITETAPKAN.

## 8. Backup, dry-run rilis, dan rollback

### 8.1 Rilis kode (patch pemisahan tugas + alat opname) — backend-saja, tanpa migrasi
Skrip: `scripts/release-pemisahan-tugas-opname.sh` (pola release-directory yang sama dengan rilis sebelumnya, fail-closed).

```bash
cat scripts/release-pemisahan-tugas-opname.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/sod.sh'
ssh ubuntu@43.133.152.6 'bash /tmp/sod.sh <DEPLOY_SHA_40> <BASE_SHA_40> --preflight-only'   # DRY-RUN: tidak mengubah apa pun
ssh ubuntu@43.133.152.6 'nohup bash /tmp/sod.sh <DEPLOY_SHA_40> <BASE_SHA_40> > /tmp/sod.out 2>&1 < /dev/null &'
```
Preflight memeriksa: leluhur & allowlist berkas, release aktif = baseline, health, tidak ada deploy lain, ruang disk, snapshot data. Rilis sebenarnya menambah: `pg_dump` + gzip + checksum, **restore nyata ke DB sementara**, build image, tag rollback, smoke baca-saja, snapshot sebelum/sesudah.

### 8.2 Rollback
- **Kode** (tanpa migrasi, tanpa perubahan data): `docker tag klinik-matras-backend:rollback-pre-sod-<sha8> klinik-matras-backend:latest` lalu `compose up -d --no-deps --force-recreate backend` dari folder release sebelumnya (instruksi dicetak skrip bila berhenti).
- **Data**: ledger append-only — tidak ada hapus. Kesalahan adjustment dikoreksi dengan **adjustment pembalik** lewat jalur yang sama (pengaju ≠ penyetuju, alasan "Pembalik ADJ-…"). Jurnal PERSEDIAAN_AWAL dikoreksi dengan "Balik jurnal persediaan awal" (Owner + PIN + alasan). Pemulihan `pg_dump` hanya untuk kerusakan data.
- Sebelum posting apa pun: backup `~/backups/pre-<kode>-<sha>-<ts>.sql.gz` + `.sha256`.

### 8.3 Dry-run adjustment
`rencana-adjustment.csv` memuat `key` idempoten `OPNAME-<tanggal>:<kode>`. Tulis key di awal `reason`; jalankan ulang tidak boleh membuat request kedua bila key sudah ada (pola yang diuji di `tests/integration/stokRekonsiliasi.integration.test.js`, test 7–8).

## 9. Keputusan yang diperlukan dari Owner
1. **Tanggal cutover baru** (rekomendasi hitung 31 Okt, cutover 1 Nov) dan pembatalan draf PSA-30092026-001.
2. **Penyetuju adjustment** (rekomendasi: OWNER dan FINANCE, berbeda orang dari pengaju) dan akun yang diberi peran WAREHOUSE tambahan.
3. **Perlakuan pembelian tanpa GR** (pembelian langsung PUR-*, tagihan tanpa penerimaan): GR retroaktif (jejak per dokumen) vs ditutup lewat selisih opname; reklas 5-1150 → 1-1400 oleh Finance bila GR retroaktif.
4. **Pemakaian lama tidak direkonstruksi**: setuju bahwa 242 order Jan–Sep tidak diposting ulang; biaya bahan periode itu mengikuti opname.
5. (Selesai) Jalur cepat `/movements/receipt|return|waste` ditutup permanen: audit pemanggil hanya modal Gudang lama, 0 pemakaian di ledger. Penerimaan lewat GR, retur lewat Retur resmi/Pengembalian Bahan Produksi, buang lewat Barang Rusak (DISPOSE). `/movements/issue` (Keluar ke Unit) dipertahankan.

## 10. Yang tidak boleh dilakukan
- Menyalin QTY SEP dari file lama ke lembar hitung atau ke Stock Count.
- Membuat Stock Count dengan jumlah hitung lama terhadap saldo hari ini (menghapus penerimaan setelah hitung — dibuktikan di test 6).
- Mengisi harga dari sheet lama / harga referensi master.
- Memposting adjustment sebelum GR/Issue tertunda diselesaikan (risiko ganda).
- Menolkan stok negatif tanpa hitung fisik.
- Mengubah role/PIN/pengaturan Finance di luar keputusan Owner.

## Lampiran A — Kolom lembar hitung
`No · Material ID · Kode · Nama · Satuan · Lokasi · Status hitung · Jumlah fisik di rak (milik SANO) · Staging Issue · GR sudah datang belum diposting · Barang dalam perjalanan · Sisa di lantai produksi (info) · Milik customer (dikecualikan) · Mulai hitung · Selesai hitung · Penghitung · Pemeriksa · Bukti · Catatan`. Fisik milik SANO = rak + staging Issue. Kolom lainnya tidak masuk fisik dan tidak masuk selisih.

## Lampiran B — Batas yang diketahui
- Lokasi di ledger hanya label (semua `GUDANG_UTAMA`): saldo global per material; hitung per lokasi dijumlahkan.
- Tidak ada penanda barang milik customer di model Material/StockMovement; pemisahannya hanya di lembar hitung.
- Pelaku pengisi hitungan Stock Count dicatat di activity log mulai rilis patch; Stock Count lama hanya punya pembuat/penugas.
- Material Issue/GR tanpa baris (GR-091026-01/02) tampil dengan jumlah dari PO di daftar dokumen tertunda; verifikasi manual.
