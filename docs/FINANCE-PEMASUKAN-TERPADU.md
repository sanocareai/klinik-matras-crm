# Pemasukan Terpadu + Data Sebelum Sistem (Finance Web & Mobile v1.1.0)

Status: kode selesai dan diuji; backend dan web ter-deploy **21 Sep 2026**. Mobile **v1.1.0** siap (kode + tes); **belum ada build/OTA** — menunggu persetujuan Owner. Push tetap OFF.

Ini **read-model/agregator**, bukan modul pembukuan: halaman membuka tidak membuat jurnal, transaksi, atau sumber baru; tidak menyentuh saldo Kas & Bank, JV-19092026-372, akun 2-1600, atau akun koreksi saldo awal.

## 1. Sumber data (audit produksi sebelum menetapkan klasifikasi)

Audit baca-saja atas jurnal produksi (per sumber × akun lawan), bukan tebakan dari nama:

| Pola nyata di produksi | Klasifikasi |
|---|---|
| `PENGAKUAN_PENDAPATAN`: Dr 1-1300 Piutang / Cr 4-1100 atau 4-1200 (30 jurnal, sejak 17 Sep 2026) | **Pendapatan Penjualan** |
| `PEMBAYARAN_ORDER`: Dr Kas-Bank / Cr 1-1300 (piutang) atau 2-1200 (uang muka/DP) | **Pembayaran Masuk** (dari tabel Payment, bukan dari jurnal) |
| `PEMASUKAN_LAIN`: Dr Bank / Cr 4-9100 Pendapatan Lain-lain | **Pemasukan Lain** |
| `MANUAL`: Dr Bank / Cr **2-1600 Utang Pihak Ketiga (Investor/Mitra)** | **Dana masuk bukan pendapatan** (pendanaan pihak ketiga) |
| `MANUAL`/`PEMASUKAN_LAIN`: Dr Bank / Cr 3-1100 Modal Pemilik | **Dana masuk bukan pendapatan** (setoran modal) |
| `TRANSFER_KAS` (Dr/Cr rekening sendiri) | **Dikecualikan** |
| `SALDO_AWAL` (saldo pembukaan Cr 3-3100; kalibrasi JV-372/391 Cr 3-4100) | **Dikecualikan** (saldo awal/koreksi saldo) |
| `REVERSAL` atas pengeluaran/kasbon (Dr Bank / Cr akun beban) | **Dikecualikan** (pembalikan biaya, bukan pemasukan) |
| Uang masuk lain yang akun lawannya tidak menentukan jenis dana | **Perlu Ditinjau** (tidak dihitung, tidak ditebak) |

## 2. Cara sistem mencegah hitung ganda

1. Enam kelas dipisah tegas: pendapatan (baris akun pendapatan penjualan − retur 4-2100), pembayaran (tabel `Payment`), piutang (saldo 1-1300 per order, posisi akhir periode), pemasukan lain (akun pendapatan non-penjualan dari sumber PEMASUKAN_LAIN), dana bukan pendapatan (akun lawan 3-1100 / 2-1600), dikecualikan.
2. Jurnal `PEMBAYARAN_ORDER` **dan pembaliknya tidak pernah dihitung dari jurnal**; pembayaran datang hanya dari tabel Payment dengan status (menunggu / terverifikasi / ditolak / dibatalkan) — DP, cicilan, dan pelunasan tidak menambah pendapatan.
3. Uang kas yang sudah dijelaskan oleh baris pendapatan pada jurnal yang sama **tidak** diklasifikasi lagi sebagai dana masuk.
4. **Pendapatan gabungan = pendapatan sistem + pendapatan historis (setelah deduplikasi)**; tidak pernah ditambah pembayaran masuk.
5. Data Sebelum Sistem hanya menghitung baris **SIAP** (atau Perlu Ditinjau yang diputuskan TERIMA); duplikat (nomor sama, order sistem, batch lain), di luar periode, dan tidak valid **tidak dihitung**.
6. Tes menjaga: tiap jurnal masuk ≤ 1 kelas uang-masuk; kunci baris unik; invoice belum dibayar = pendapatan + piutang, bukan penerimaan kas.

## 3. Endpoint (aditif; semua butuh `FINANCE_READ`; tulis Data Sebelum Sistem butuh `FINANCE_POST`)

- `GET /api/finance/pemasukan/ringkasan?from&to` — pendapatan sistem (bruto, retur), historis, gabungan, pembayaran (terverifikasi/menunggu/tidak dihitung/belum dibukukan), piutang tersisa, pemasukan lain, dana masuk (rincian), perlu ditinjau, dikecualikan, cutoff + celah pengakuan, penjelasan.
- `GET /api/finance/pemasukan?from&to&kategori&status&rekening&pihak&q&sumber&page&limit` — daftar terklasifikasi; baris memuat tanggal, nomor, sumber, pihak, keterangan, rekening, nilai (string), status, klasifikasi, tautan.
- `GET /api/finance/pemasukan/opsi` — kategori, status, rekening, cutoff, `aksiCatat` (hanya menunjuk ke Pemasukan Lain).
- `GET /api/finance/pemasukan/:jenis/:id` (`jurnal|pembayaran|historis`) — detail + klasifikasi.
- Data Sebelum Sistem: `GET /pemasukan/legacy/cutoff`, `GET|POST /pemasukan/legacy/batch` (multipart `file`), `GET /pemasukan/legacy/batch/:id`, `POST …/impor`, `POST …/batal` (alasan wajib), `POST /pemasukan/legacy/baris/:id/keputusan` (TERIMA|ABAIKAN), `GET /pemasukan/legacy/rekonsiliasi`, `GET /pemasukan/legacy/proposal`.
- Tidak ada endpoint pembuat jurnal/pemasukan umum. Pencatatan baru hanya ke workflow **Pemasukan Lain** yang ada (validasi akun server: akun penjualan ditolak).

## 4. Data Sebelum Sistem

**Cutoff dari data produksi**: order sistem paling awal = `RES-12072026-001`, **12 Jul 2026** (526 order Jul–Sep). Transaksi arsip **sebelum** 12 Jul = Data Sebelum Sistem; pada/sesudahnya harus berasal dari order/invoice sistem (baris arsip ≥ cutoff berstatus *Di luar periode*, tidak dihitung).

**Temuan penting di produksi (informasi, tidak dijumlahkan):** pengakuan pendapatan di buku baru dimulai **17 Sep 2026**. Order sistem 12 Jul–16 Sep (**458 order senilai Rp1.051.563.000**: Jul 123 / Rp294,97 jt, Agu 216 / Rp532,31 jt, Sep 119 / Rp224,28 jt) **belum memiliki pengakuan pendapatan di buku besar**. Ini bukan bagian Data Sebelum Sistem dan tidak masuk pendapatan gabungan; Owner perlu memutuskan penanganannya.

Fitur: impor CSV/XLSX (alias kolom Indonesia/Inggris; tanggal ISO, dd/mm/yyyy, "January 12, 2026", serial Excel; nominal "Rp 1.500.000"/"1,500,000.50"/negatif tanpa float), pratinjau + validasi, ID legacy stabil (nomor lama, atau `LEG-`+hash tanggal|pelanggan|nominal|keterangan), simpan nama berkas/batch/waktu/pengguna, idempoten (sha256 berkas + identitas baris), deteksi duplikat (arsip lain, **nomor order sistem**, dan kemungkinan cocok pelanggan+nominal+tanggal ±3 hari → Perlu Ditinjau), baris meragukan = **Perlu Ditinjau** (tidak dihitung), batal selama belum diposting, rekonsiliasi total per bulan Januari→cutoff (sudah/belum dibayar, rekening bila diketahui, duplikat/mirip order, selisih vs jurnal saat ini), simulasi dampak, dan **proposal jurnal migrasi (JSON saja, tidak diposting)**.

Label wajib: “Data sebelum sistem berasal dari arsip lama dan belum memengaruhi buku besar sampai proses rekonsiliasi dan posting disetujui.”

**Posting = tahap berikutnya, menunggu persetujuan Owner.** Proposal memakai: Dr Piutang untuk yang jelas belum dibayar, Dr **3-4100** (ekuitas non-kas) untuk bagian yang sudah dibayar/tidak diketahui, Cr pendapatan (akun **diasumsikan** 4-1200; Owner memetakan). **Tidak** menyentuh Kas & Bank (sudah dikalibrasi ke saldo riil; memposting penerimaan lama ke kas akan menghitung dua kali).

## 5. Temuan pada data lama (produksi, baca-saja)

Periode 1 Jan–30 Sep 2026: pendapatan sistem Rp64.696.000 (30 pengakuan); pembayaran terverifikasi 23 (Rp50.883.030); pemasukan lain 3 (Rp40.437.937); dana masuk bukan pendapatan 9 catatan (Rp22.950.000 — seluruhnya pendanaan pihak ketiga 2-1600); dikecualikan: transfer 5 (Rp15,05 jt), saldo awal/koreksi 5, pembalikan pengeluaran 28 (Rp110,17 jt). **Perlu ditinjau: 2 pembayaran terverifikasi (Rp2.830.000) tanpa rekening dan tanpa jurnal** — salah satunya (Rp850.000) tidak punya catatan *posting gap* sama sekali. Tidak ada jurnal yang dibuat oleh pekerjaan ini (selisih 0).

## 6. Gap dan keputusan bisnis yang masih diperlukan

1. **Pengakuan pendapatan Jul–16 Sep** (458 order, Rp1,05 miliar): diakui retroaktif, atau dibiarkan? (keputusan Owner; bisa dimasukkan ke proposal migrasi).
2. **Unggah arsip Notion** (belum ada berkas di produksi): register masih kosong; angka historis 0 sampai diimpor dan direkonsiliasi.
3. **Persetujuan posting** proposal jurnal migrasi dan pemetaan akun pendapatan.
4. **2 pembayaran terverifikasi tanpa rekening** (Rp2,83 jt): dipetakan lewat Data belum lengkap (dan disesuaikan dengan kalibrasi JV-391).
5. Perbandingan periode, ekspor, dan chart tetap v1.1+/web.
6. Mobile: impor/rekonsiliasi/posting Data Sebelum Sistem hanya di web (mobile membaca).

## 7. Tes & QA

Backend: 11 tes integrasi `financePemasukan` + 9 `financeLegacyPendapatan` (serial, DB test terpisah), termasuk: invoice belum dibayar, DP/cicilan/pelunasan, ditolak/dibatalkan/dibalik, Pemasukan Lain vs penjualan, modal & pinjaman, transfer & saldo awal dikecualikan, retur negatif, "Perlu ditinjau", izin, paginasi/filter, tidak ada jurnal saat membaca, parser, cutoff, pratinjau/dedup/idempoten, XLSX, batal, rekonsiliasi & proposal (tidak diposting), dan **tidak ada efek ke jurnal, saldo Kas & Bank, Neraca, invoice**. Mobile: 14 tes (kontrak dengan respons backend nyata `pemasukan-real.json` + layar). Web: build produksi + QA visual (terang/gelap, 1440, tablet 820, HP 390, zoom 150%) dengan respons nyata.

## 8. Rollback

- **Web/backend:** `git revert` commit fitur → `git pull` + `docker compose up -d --build backend` (web dari `frontend/dist`: build ulang). Migrasi `20260921180000_fin_legacy_revenue` **aditif** (2 tabel baru); aman dibiarkan. Tidak ada data produksi yang diubah.
- **Data Sebelum Sistem:** batalkan batch (`POST …/batal`) — baris berhenti dihitung seketika; tidak ada jurnal yang perlu dibalik karena belum ada posting.
- **Mobile:** v1.1.0 belum dirilis; bila dirilis, rollback = `eas update:rollback` / pasang build 1.0.0.

## 9. Koreksi & lanjutan (21 Sep 2026, malam)

- **Koreksi angka celah pengakuan:** "458 order Rp1.051.563.000 belum diakui" di §4–§6 ternyata mencakup **30 order (Rp65,1 jt) yang sudah diakui** pada 17–21 Sep (dibuat sebelum 17 Sep, diserahkan sesudahnya). Yang belum diakui = 428 order. `celahPengakuan` kini mengeluarkan order yang sudah diakui dan memuat `sudahDiakuiDalamJendela`.
- **Arsip Notion sudah diimpor** (batch `e6e156d7…`, non-posting): lihat `docs/FINANCE-REKONSILIASI-PENDAPATAN-2026.md`.
- **Pemetaan akun proposal legacy:** tidak lagi default 4-1200; akun menurut jenis transaksi pada keterangan, yang tak terpetakan tidak dijurnal.
- Rekonsiliasi rekening (terpisah): `docs/FINANCE-REKONSILIASI-REKENING-20260921.md`.
