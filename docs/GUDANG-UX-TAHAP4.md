# UX Gudang Tahap 4 — Pusat Kerja Harian dan Penanganan Masalah

Branch `feat/gudang-ux-tahap4` (di atas Tahap 3 live `58cbc284`). **Belum deploy.** Tidak ada migrasi, tidak ada perubahan skema, tidak ada perubahan akuntansi. Semua endpoint baru **baca-saja**.

## 1. Audit UX saat ini (sebelum Tahap 4)

| Area | Keadaan sebelum | Masalah bagi petugas |
|---|---|---|
| Beranda Gudang | 5 kartu tugas dari `GET /inventory/beranda` (jumlah + 3 contoh, tautan ke daftar). | Tidak menjawab "dokumen mana, mengapa, tindakan apa, siapa berikutnya"; hanya 5 dari ±12 jenis pekerjaan; tidak ada selesai-terbaru, tidak ada pemisahan terlambat/tertahan; satu klik = pindah halaman daftar. |
| Detail dokumen | Penerimaan = jendela fokus (Tahap 3), PO = jendela lokal di Barang Akan Datang. **Pengeluaran Material, Transfer, Stock Opname, Restok, Barang Rusak, Retur, Penyesuaian = halaman terpisah** (`/…/:id`, tautan "Kembali"). Koreksi Gudang = akordeon di tab. Retur Supplier = Modal bersama Finance. | Tiga pola berbeda; membuka dokumen menghilangkan daftar (filter/gulir) dan riwayat Back tidak konsisten. |
| Masalah | Tidak ada tempat berisi masalah nyata: stok negatif, saldo belum diketahui, bahan belum dikelompokkan, batas minimum belum diatur, penerimaan tertahan, selisih transfer, dsb. tersebar di halaman masing-masing. | Petugas harus mencari sendiri; tidak jelas siapa pemilik tindakan dan seberapa luas dampaknya. |
| Pencarian | Hanya pencarian per daftar. | Tidak bisa mencari nomor GR/PO/MI/transfer/Stock Count/Koreksi dari satu tempat. |
| Komponen mati / tumpang tindih | `pages/Gudang.jsx` (563 baris, command center lama) tidak lagi diimpor siapa pun; `KoreksiDokumenTab` mode akordeon; rute detail terpisah. | Beban perawatan; lihat bagian 8. |
| Mobile | Detail halaman penuh, bilah aksi ikut bergulir. | Aksi utama tidak selalu terjangkau. |

**Volume data production (baca-saja, `SELECT` count dengan `default_transaction_read_only=on`, 19 Okt 2026):** goods_receipts 13 (COMPLETED 10, DRAFT 1, SCHEDULED 1, READY_FOR_PUTAWAY 1); stock_counts 1 (COMPLETED); material_issues, stock_transfers, warehouse_corrections, penyesuaian, restok, barang rusak, retur, retur supplier = 0; materials aktif 358 (nonaktif 15). Artinya produksi saat ini kecil — rancangan berbasis **kartu** dengan **pagination server (8 pertama + "Tampilkan lagi" 20 per halaman)** dipilih agar tetap benar pada 100+ dokumen (diuji, lihat bagian 6), bukan karena beban hari ini.

**Bentrok scope:** tidak menyentuh berkas Produksi/Delivery sesi lain (`feat/status-lintas-workspace`, 77 berkas Produksi/Delivery); satu-satunya titik temu adalah pembacaan antrean Produksi V2 yang hanya aktif bila `resolveProductionReaderState` ≠ OFF (inert di production). Tidak menyentuh pembersihan disk VPS (tidak ada operasi VPS selain baca).

## 2. Matriks antrean → alasan → aksi → pemilik

Setiap kartu memuat: nomor dokumen, supplier/unit/bahan terkait, umur (sejak dokumen terakhir diubah — **bukan SLA**), status, **alasan muncul** (teks dari server), **satu tindakan utama** (hanya bila pengguna berizin dan sah untuk status saat ini), **pemilik tindakan** dan **pemilik berikutnya**. Definisi tertulis ikut di respons (`definisi`) dan tampil di tombol "Definisi antrean ini".

| Antrean | Alasan muncul (contoh) | Tindakan utama (kode) | Pemilik → berikutnya |
|---|---|---|---|
| Dijadwalkan datang | "Draf belum dijadwalkan" / "Dijadwalkan datang <tgl>" / "Jadwal <tgl> sudah lewat N hari…" | Jadwalkan kedatangan (`JADWALKAN`) · Catat barang tiba (`CATAT_TIBA`/`TANDAI_TIBA`) | Gudang → Gudang |
| Barang tiba — perlu diperiksa | "Barang sudah tercatat tiba…" / "Pemeriksaan belum lengkap: N dari M item…" (+ "Pemeriksaan sebelumnya dibatalkan — hasil baru wajib") | Periksa barang / Lengkapi hasil pemeriksaan / Nyatakan siap masuk stok (`MAJUKAN`, `ISI_PEMERIKSAAN`) | Gudang → Gudang |
| Siap masuk stok | "Hasil pemeriksaan lengkap; stok bertambah saat Simpan ke Stok" / "…tidak ada jumlah baik — akan ditolak" | Simpan ke stok (`SIMPAN_KE_STOK`) | Gudang → Finance (bila ber-PO) |
| Permintaan bahan | status + "Dibutuhkan <tgl> (lewat N hari)" + kekurangan saldo per bahan | Setujui / Siapkan / Serahkan / Konfirmasi keluar | Gudang → Gudang (Produksi bila sumber produksi) |
| Transfer stok | status + selisih terbuka | Setujui / Tandai diambil / Kirim / Terima / Selesaikan selisih | Gudang |
| Stock Count | "Terjadwal <tgl>" / "Sedang dihitung" / "Menunggu tinjauan selisih" | Mulai hitung / Serahkan hitungan / Tinjau & selesaikan | Gudang; tinjauan: penyetuju ≠ penghitung |
| Koreksi & penyesuaian menunggu | "Menunggu keputusan penyetuju" / "Anda pemohon; keputusan harus dari penyetuju lain" | Putuskan / Posting — **hanya untuk penyetuju** | Owner/Finance; bagi non-penyetuju masuk "Menunggu workspace lain" |
| Restok, barang rusak, retur | status masing-masing | Setujui, Tandai dipesan, Periksa, Selesaikan, Terima | Gudang / penyetuju |
| Retur Supplier | "Draf — barang belum keluar" / "Barang sudah keluar; debit note belum dibuat" | Konfirmasi barang keluar | Gudang → Finance |
| Produksi V2 (bahan, unit masuk, barang jadi, kekurangan, sisa bahan) | dari antrean Gudang Produksi V2 | dibuka di Antrean Produksi (aksi inline di sana) | Gudang → Produksi/Delivery — **hanya dihitung bila pembaca V2 aktif; inert di production** |

### Definisi per antrean (sumber tabel, masuk, keluar, siapa boleh bertindak, dihitung per dokumen atau baris)

| Kode | Judul | Sumber tabel | Masuk bila | Keluar bila | Yang bertindak | Dihitung per | Catatan |
|---|---|---|---|---|---|---|---|
| PENERIMAAN_AKAN_DATANG | Dijadwalkan datang | goods_receipts | Status Draf atau Terjadwal (barang belum dicatat tiba). | Barang dicatat tiba, atau penerimaan dibatalkan. | Gudang (izin tulis Inventory) | dokumen | Terlambat hanya bila jadwal penerimaan (atau estimasi PO bila jadwal kosong) sudah lewat. |
| PENERIMAAN_PERIKSA | Barang tiba — perlu diperiksa | goods_receipts + goods_receipt_lines | Status Barang tiba atau Pemeriksaan (barang tercatat tiba, hasil belum lengkap untuk semua item). | Hasil lengkap lalu dinyatakan Siap masuk stok. | Gudang | dokumen | Dokumen kosong lama (tanpa jumlah apa pun) tidak dihitung. |
| PENERIMAAN_SIAP_STOK | Siap masuk stok | goods_receipts | Status Siap masuk stok. | Simpan ke Stok (stok bertambah) atau dikembalikan ke Pemeriksaan. | Gudang; sesudahnya Finance mencatat faktur supplier. | dokumen |  |
| PERMINTAAN_BAHAN | Permintaan bahan | material_issues (production_plan_id kosong) | Menunggu persetujuan, Disetujui, Siap diambil, atau Sudah diambil. | Dikeluarkan atau dibatalkan. | Gudang (izin tulis Inventory) | dokumen | Antrean bahan Produksi V2 dihitung terpisah (PRODUKSI_*). |
| TRANSFER | Transfer stok | stock_transfers | Menunggu persetujuan, Disetujui, Sudah diambil, Dalam perjalanan, atau Selesai dengan selisih belum diselesaikan. | Selesai tanpa selisih terbuka, atau dibatalkan. | Gudang | dokumen |  |
| STOCK_COUNT | Stock Count | stock_counts | Terjadwal (mulai hitung), Sedang dihitung, atau Menunggu tinjauan. | Selesai atau dibatalkan. | Gudang; selisih disetujui penyetuju yang bukan pembuat/penghitung. | dokumen |  |
| KOREKSI_PENYESUAIAN | Koreksi & penyesuaian menunggu keputusan | warehouse_corrections + stock_adjustment_requests | Koreksi Menunggu persetujuan; penyesuaian Menunggu persetujuan atau Disetujui (belum diposting). | Diterapkan, ditolak, atau dibatalkan. | Penyetuju (izin persetujuan Inventory — Owner/Finance); pemohon tidak boleh menyetujui sendiri. | dokumen |  |
| RESTOK_RUSAK_RETUR | Restok, barang rusak, dan retur | replenishment_requests + damaged_stock_records + return_records | Restok Menunggu persetujuan/Disetujui; barang rusak Dilaporkan/Diperiksa; retur Dibuat/Diterima/Diperiksa. | Selesai, ditolak, atau dibatalkan. | Gudang | dokumen |  |
| RETUR_SUPPLIER | Retur Supplier | supplier_returns | Draf (barang belum keluar). | Barang keluar dikonfirmasi atau dibatalkan. | Gudang (konfirmasi barang keluar); sesudahnya Finance (debit note). | dokumen |  |
| PRODUKSI_BAHAN | Bahan Produksi menunggu diserahkan | production plan + material issue V2 (hanya bila pembaca Produksi V2 aktif) | Kebutuhan bahan berstatus Menunggu disiapkan atau Siap diambil. | Sudah diserahkan. | Gudang; sesudahnya Produksi. | rencana produksi (unit) |  |
| PRODUKSI_UNIT_MASUK | Unit dari Delivery menunggu diterima | unit_custody_handoffs_v2 (INBOUND, OFFERED) | Serah-terima ditawarkan. | Diterima atau ditolak. | Gudang | unit |  |
| PRODUKSI_BARANG_JADI | Barang jadi menunggu diterima | unit_custody_handoffs_v2 (FINISHED_GOODS, OFFERED) | Serah-terima barang jadi ditawarkan Produksi. | Diterima (lokasi wajib) atau ditolak. | Gudang; sesudahnya Delivery. | unit |  |
| PRODUKSI_KEKURANGAN | Kekurangan bahan dilaporkan Produksi | production_material_shortages_v2 (OPEN) | Laporan kekurangan terbuka. | Diselesaikan Gudang. | Gudang | laporan |  |
| PRODUKSI_SISA_BAHAN | Sisa bahan menunggu diterima | pengembalian bahan V2 (PENDING) | Pengembalian bahan dari Produksi tertunda. | Diterima Gudang. | Gudang | pengembalian |  |


### Sebab terlambat / tertahan (dipisah menurut penyebab nyata)

"Terlambat" **hanya** dipakai bila ada tanggal sah (jadwal penerimaan/estimasi PO, tanggal dibutuhkan, jadwal hitung) yang sudah lewat; dokumen tanpa tanggal tidak pernah disebut terlambat. Umur antrean bukan SLA dan tidak pernah dipakai untuk kata "terlambat".

- **JADWAL_LEWAT** — ada tanggal sah dan sudah lewat.
- **STOK_TIDAK_CUKUP** — permintaan bahan/transfer disetujui meminta lebih dari saldo fisik; menahan dokumen itu (dan bahan itu) saja.
- **DATA_WAJIB** — hasil pemeriksaan belum lengkap, atau pemeriksaan sebelumnya dibatalkan sehingga hasil baru wajib.
- **MENUNGGU_WORKSPACE** — tindakan berikutnya ada pada peran lain (penyetuju untuk koreksi/penyesuaian; Finance untuk debit note retur supplier).
- **PERLU_KOREKSI_RESMI** — hanya lewat jalur resmi (tinjau selisih hitungan, selesaikan selisih transfer, koreksi dokumen; permintaan bahan untuk order dibatalkan).
- **Konflik revisi — tidak dihitung.** Terjadi saat dua orang mengubah dokumen yang sama dan hanya tampil di dokumen; tidak ada data tersimpan untuk dihitung. Dinyatakan di layar ("Tidak dihitung"), bukan dikarang angkanya.

### Pusat Masalah ("Perlu Perhatian")

Tiap masalah: **apa**, **dampak**, **cakupan** (Satu/beberapa bahan · Satu dokumen · Satu fitur · Seluruh proses), **pemilik tindakan**, **tindakan resmi** (tautan), contoh dokumen/bahan yang membuka jendela fokus. Tidak ada blocker global: setiap masalah dibatasi bahan/dokumen/fitur, dan layar menyatakannya.

| Masalah | Cakupan | Pemilik | Tindakan resmi |
|---|---|---|---|
| Stok negatif | Bahan | Gudang | Stock Count lalu selesaikan selisih; Ajukan Penyesuaian Stok |
| Saldo belum diketahui | Bahan | Gudang | Catat saldo awal lewat Stock Count / Opname Cutover |
| Bahan belum dikelompokkan | Bahan (tampilan saja) | Owner | Isi daftar keputusan kelompok |
| Batas minimum belum diatur | Fitur (saran restok) | Gudang | Ubah Item di Stok & Lokasi |
| Penerimaan tertahan | Dokumen | Gudang | Buka dokumen, lengkapi / catat tiba |
| Pemeriksaan dibatalkan | Dokumen | Gudang | Isi/konfirmasi hasil baru |
| Selisih transfer belum diselesaikan | Dokumen | Gudang | Selesaikan selisih (ditemukan/susut) |
| Stock Count berselisih | Dokumen | Owner/penyetuju | Tinjau & selesaikan (penyetuju ≠ penghitung) |
| Koreksi/penyesuaian menunggu | Dokumen | Owner/Finance | Putuskan |
| Bahan sudah keluar untuk order dibatalkan | Dokumen | Gudang | Kembalikan lewat jalur resmi |
| Menunggu Finance (debit note) | Dokumen | Finance | Pantau di Retur Supplier |
| Dokumen tertahan stok tidak cukup | Dokumen + bahan | Gudang | Terima barang / kurangi jumlah / ajukan restok |

## 3. Rancangan sebelum → sesudah

**Sebelum:** Beranda = 5 kartu angka; detail = halaman/akordeon/modal bercampur; masalah tersebar; tanpa pencarian lintas dokumen.

**Sesudah:** satu pola. Daftar/Beranda/Perlu Perhatian tetap terpasang; dokumen terbuka sebagai **jendela fokus** (URL berubah dan bisa dibagikan; Esc/Tutup/Back mengembalikan konteks termasuk filter dan posisi gulir; satu lapisan — formulir/konfirmasi menjadi panel di jendela yang sama; bilah aksi tetap di dasar jendela untuk Penerimaan, Pengeluaran Material, Transfer, Stock Opname, Restok, Barang Rusak, Retur, dan Penyesuaian; Koreksi Gudang dan PO menampilkan tombolnya di isi dokumen).

Wireframe desktop (1440 px):

```
┌ Beranda Gudang ─────────────────────────────────────────── [Muat Ulang] ┐
│ [🔍 Cari nomor, bahan, supplier, unit…                                ] │
│ [140 perlu dikerjakan] [42 terlambat/tertahan] [⚠ Perlu Perhatian ›]    │
│ Perlu dikerjakan sekarang                                               │
│  Dijadwalkan datang  [60 dokumen]   ▸ Definisi antrean ini              │
│  ┌ GR-0001 [Penerimaan] [Terjadwal — menunggu barang tiba]  hari ini ┐  │
│  │ Tanpa PO · Toko 0                                                  │  │
│  │ Terjadwal tanpa tanggal; barang belum dicatat tiba.                │  │
│  │ Yang bertindak: Gudang · Sesudahnya: Gudang                        │  │
│  ├────────────────────────────────────────────────────────────────────┤  │
│  │ [Catat barang tiba]                                                │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│  … 8 kartu · [Tampilkan lagi (52 lainnya)]                              │
│ Terlambat atau tertahan  → per sebab (Melewati jadwal / Stok tidak      │
│   cukup / Data wajib / Menunggu workspace lain / Perlu koreksi resmi)   │
│ Selesai terbaru (7 hari)                                                │
└──────────────────────────────────────────────────────────────────────────┘
   klik kartu → /warehouse/dashboard/<jenis>/<id>  (jendela di atas Beranda)
```

Wireframe HP (390 px): satu kolom; judul + pencarian + dua lencana ringkas + tautan Perlu Perhatian; tiap kartu penuh lebar (tinggi ≥ 44 px), tombol tindakan penuh lebar di bawah kartu; jendela dokumen layar penuh dengan header tetap dan bilah aksi tetap di dasar; kolom jumlah memakai keyboard angka (`inputmode=decimal`); tanpa scroll horizontal.

## 4. Cakupan implementasi

| Bagian | Status |
|---|---|
| Beranda berbasis pekerjaan (antrean, alasan, aksi utama, pemilik, definisi, Tampilkan lagi, selesai terbaru, terlambat/tertahan per sebab, "tidak dihitung") | ✅ |
| Jendela fokus satu pola: Penerimaan (Tahap 3), PO, Pengeluaran Material, Transfer, Stock Opname, Restok, Barang Rusak, Retur, Penyesuaian, Koreksi Gudang — dari daftar (`/…/:id?`), Beranda, Perlu Perhatian, pencarian | ✅ |
| Retur Supplier | ◐ detail dikendalikan **rute** (`/warehouse/retur-supplier/:id`, URL dapat dibagikan, Back/Tutup mengembalikan daftar) tetapi tetap `Modal` bersama Finance — belum `FokusOverlay` agar Finance tidak berubah |
| Penerimaan unit & barang jadi (Produksi V2) | ⛔ tidak diubah: aksi inline di Antrean Produksi, tanpa dokumen mandiri; antreannya tampil di Beranda hanya bila pembaca V2 aktif (inert di production) |
| Pusat Masalah "Perlu Perhatian" (12 jenis masalah, cakupan, pemilik, tindakan) | ✅ |
| Pencarian Gudang (GR, PO, bahan, supplier, unit/order, Stock Count, MI, Transfer, Koreksi, Restok, Rusak, Retur, Penyesuaian, Retur Supplier) + tindakan cepat sesuai izin/status | ✅ |
| Mobile: target ≥ 44 px, kartu ringkas, jendela layar penuh, bilah aksi tetap, keyboard angka, tanpa scroll horizontal, klik ganda aman | ✅ |
| Kamera / barcode | ⏭ **sengaja tidak dibuat** (di luar scope). Tahap berikutnya: pindai kode di kolom jumlah/lokasi dan di pencarian; belum ada UI palsu. |
| Di luar scope (tidak disentuh): saldo stok per lokasi, perpindahan fisik berbasis bin/rak, migrasi kelompok bahan permanen, perubahan akuntansi, penghapusan upload production | — |

**Baca-saja:** Beranda, Perlu Perhatian, dan pencarian hanya memanggil `GET /api/inventory/pusat-kerja/*`. Tombol tindakan di kartu/hasil hanya muncul bila server menyatakan pengguna berizin dan aksi sah untuk status saat ini; menekannya hanya **membuka dokumen dengan `?aksi=KODE`**: aksi berpanel/konfirmasi/formulir dibuka, aksi langsung hanya **disorot** — pengguna tetap menekan tombol akhir di dokumen; server tetap menegakkan izin, revisi, dan idempotensi.

## 5. Dampak ke API dan data

- **Endpoint baru (semua GET, `inventory:read`):** `/api/inventory/pusat-kerja` (Beranda), `/antrean/:kode`, `/tertahan/:kode`, `/selesai`, `/perhatian`, `/cari?q=`. Hasil pencarian membawa `aksi` (kode+label) hanya bila pengguna berizin tulis dan aksi sah.
- **Tidak ada** migrasi, perubahan skema, perubahan endpoint tulis, perubahan ledger/movement/jurnal. `GET /inventory/beranda` + `services/gudangBeranda.js` **dipertahankan** (dipakai badge sidebar).
- **Beban:** satu panggilan Beranda menghitung dari tabel dokumen aktif (batas `take` 2000/500 per tabel) + snapshot stok; dengan 100+ dokumen uji: lihat bagian 6. Respons per antrean hanya 8 item; sisanya lewat `/antrean/:kode?offset=&limit=`.
- **Frontend:** `api.js` +5 fungsi baca (+`getKoreksiGudang`); rute detail terpisah dihapus dari `pageRegistry.jsx` dan diganti `/:id?`; sidebar +1 item ("Perlu Perhatian", grup Kontrol).

## 6. Hasil QA

DB terisolasi `km_qa_t4_test` (bukan production), 100+ dokumen: 101 penerimaan (60 dijadwalkan: 20 tanpa tanggal, 20 lewat jadwal, 10 hari ini, 10 depan; 15 tiba; 10 pemeriksaan; 5 siap stok; 10 penerimaan kosong lama yang **tidak** dihitung), 31 permintaan bahan, 15 transfer (3 selesai: 2 berselisih), 4 Stock Count, koreksi/penyesuaian/restok/rusak/retur/PO.

| Pengujian | Desktop 1440 | HP 390 |
|---|---|---|
| `flows7.mjs` (browser nyata) | 103/103 lulus | 108/108 lulus |
| Tes integrasi backend `gudangPusatKerja` (100+ dokumen, terlambat/tertahan nyata, izin, paginasi, Pusat Masalah, pencarian + tindakan cepat, tanpa jalur tulis) | 6/6 | — |
| Tes frontend baru `gudangUxTahap4.test.js` | 11/11 | — |
| Tes frontend lama yang mengunci struktur lama (diperbarui sesuai pola baru): UxTahap1/2/3, koreksiGudang, gudangPintuMasuk, returSupplierUI, poTerintegrasiUI, legacyProductionRoutes | lulus | — |
| Suite frontend penuh | 1176 tes, 9 gagal = **9 gagal lama yang sama dengan baseline** (Unit 360 ×3, toIsoOrNull, gulir otomatis, shell onBack, view sintetis, Layar angka dari server, aktivasi Jadwalkan) | — |
| Regresi integrasi backend (Gudang, Koreksi, Retur Supplier, Opname Cutover, Produksi MI/QC/antrean, Finance) | 22 berkas, 222 tes, semua lulus | — |

Yang dicakup `flows7.mjs`: struktur Beranda + hitungan = server; kartu memuat dokumen/status/alasan/umur/pemilik; definisi antrean; "terlambat" hanya bertanggal; konflik revisi "tidak dihitung"; jendela fokus dari kartu (URL, satu lapisan, Beranda tetap, Esc/Tutup/Back/Forward, gulir tetap); deep link semua 12 jenis; "Tampilkan lagi" 60/60 tanpa duplikat; tindakan cepat hanya membuka/menyorot (stok/movement/jurnal/status tidak berubah); pencarian lintas dokumen; Perlu Perhatian (cakupan, tanpa blocker global); 8 pola daftar+jendela; Back kembali ke daftar dengan filter utuh; akun baca-saja; perbedaan izin (Owner vs Gudang untuk koreksi); loading/galat/kosong/dokumen tidak ditemukan; dokumen sudah diproses pengguna lain (idempoten, keadaan terbaru tampil); klik ganda = satu perpindahan; bilah aksi tetap; keyboard angka; target sentuh HP; performa 100+ dokumen. Tangkapan layar: `C:\tmp\km-gudang-iso\qa\t4\{desktop,hp}\`.

**Batas pengujian yang jujur:** diuji di Chrome headless terhadap DB terisolasi; belum di perangkat fisik (Android/iOS) dan belum dengan akun production nyata (tidak ada transaksi QA di production — instruksi). Antrean Produksi V2 tidak terisi di QA (pembaca V2 OFF, sama seperti production).

## 7. Keputusan

- **Kandidat:** `ujung branch `feat/gudang-ux-tahap4` (kode terakhir `d6824695`; commit sesudahnya hanya dokumen/pemformatan)` (branch `feat/gudang-ux-tahap4`, dasar live `58cbc284`; belum merge ke `main`, `main` masih `694f2184`).
- **Keputusan: GO untuk rilis frontend+backend (code-only) setelah persetujuan Owner**, dengan syarat: (1) cek ulang live saat rilis (sesi lain bisa menggeser), (2) skrip rilis bergerbang dibangkitkan dari generator Tahap 3 terhadap baseline live saat itu, (3) disk VPS 4,3 GB (96%) di bawah gerbang 5 GB skrip rilis — perlu pembersihan aman atau pengecualian eksplisit. **NO-GO** bila baseline live bergeser ke berkas Gudang atau ada migrasi baru.
- **Risiko residual:** Retur Supplier masih Modal; Antrean Produksi V2 belum terverifikasi dengan data nyata (reader OFF); belum ada uji perangkat fisik; hitungan Beranda membaca tabel dokumen aktif secara penuh (aman untuk volume sekarang; jika dokumen aktif melebihi ±2000 per tabel perlu indeks/ringkasan terhitung).

## 8. Komponen lama yang aman dihapus kemudian (bukan di Tahap 4)

- `frontend/src/pages/Gudang.jsx` (563 baris, command center lama) — tidak diimpor siapa pun; dirujuk komentar di `Layout.jsx` dan `inventoryReal.js`, serta dibaca teksnya oleh `penyesuaianStok.test.js`/`gudangPintuMasuk.test.js` (perlu disesuaikan sebelum menghapus).
- Mode akordeon `KoreksiDokumenTab` (bila `onBuka` tidak diberikan) — kini hanya jalur cadangan.
- Tautan `?buka=<id>` lama di Pengeluaran Material/Transfer/Penerimaan — masih dipertahankan untuk kompatibilitas tautan notifikasi; hapus bila tautan lama sudah tidak beredar.
- **Jangan hapus:** `services/gudangBeranda.js` dan `GET /inventory/beranda` (badge sidebar), `ActiveComplaintsWidget`.
