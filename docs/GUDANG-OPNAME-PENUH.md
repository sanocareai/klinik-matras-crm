# Stock Opname Penuh — UX dan aturan waktu acuan

Branch `feat/gudang-opname-penuh` (dari live `cb33a07d`). **Belum deploy. Tidak ada sesi opname dibuat di production. Data production hanya dibaca (SELECT, transaksi read-only).**
Berbeda dari rilis UX sebelumnya: **kandidat ini membawa SATU migrasi aditif** (`20261222090000_stock_count_sesi_penuh`) — lihat bagian 6.

## 1. Audit kontrak Stock Count yang ada (sebelum diubah)

| Hal | Perilaku lama | Akibat untuk opname penuh |
|---|---|---|
| Membuat sesi | `POST /inventory/stock-counts` dengan `lines:[{materialId}]` dari klien; modal "Jadwalkan Stock Count" menambah bahan satu per satu (Tambah Item → buka dropdown → pilih). | Menjadwalkan 358 bahan ≈ **1.077 interaksi**. Daftar Material ID dikirim klien, tidak ada pratinjau cakupan, tidak ada cakupan tersimpan. |
| Saldo sistem | `systemQty` direkam **sekali untuk semua baris saat Mulai hitung**. | Sesi yang berjalan berhari-hari membandingkan fisik hari ke-3 dengan saldo hari ke-1 (basi). |
| Transaksi selama sesi | `muatPergerakanSesi`: semua pergerakan sesudah `startedAt` **harus ditandai satu per satu** (sudah/belum masuk hitungan fisik); Selesaikan ditolak selama ada yang belum ditandai. | Pada sesi penuh berhari-hari jumlah pergerakan bisa ratusan; menandainya satu per satu tidak layak. |
| Hasil hitung | `PATCH /:id/lines/:lineId` satu baris per permintaan, tanpa revisi, tanpa waktu/petugas per baris. | Dua petugas bisa saling menimpa diam-diam; tidak ada waktu acuan per bahan. |
| Kosong vs 0 | Backend sudah membedakan `null` dan `0`. | Dipertahankan; UI baru menegaskan "kolom kosong = belum dihitung". |
| Blind count | Saldo hanya disembunyikan **di layar**; respons server tetap membawa `systemQty` dan pergerakan sesi. | Penghitung bisa melihat saldo lewat respons API. Sekarang disaring di server (sesi baru). |
| Selesaikan | Lock baris + cek status; pemanggilan kedua → 400. | Dibuat idempoten untuk sesi baru (`ulang:true`, tanpa penulisan kedua). |
| Pemisahan tugas | Penyetuju ≠ pembuat/penugas/pengisi hitungan/pemberi tanda; Opname Penuh wajib diperiksa petugas lain. | **Tidak diubah.** |

## 2. Rancangan final

### 2.1 Membuat sesi (dialog "Jadwalkan Stock Opname")
Tiga pilihan jelas (tanpa pilihan bawaan, supaya sesi penuh tidak terbuat tidak sengaja):

1. **Opname penuh** — sekali pilih memasukkan seluruh bahan aktif. Opsi pengecualian per jenis (Bahan baku, Setengah jadi, Barang jadi, Habis pakai/non-inventory, Tanpa kategori); bawaan: **tidak ada yang dikecualikan**. Pengecualian per bahan tersedia di API (alasan wajib).
2. **Per kelompok** — centang satu atau beberapa kelompok (Busa, Kain, Benang, Pegas, Kayu, Lem/Kimia, Aksesori, Lainnya, Belum dikelompokkan) dengan jumlah bahan aktif tiap kelompok.
3. **Cycle Count** — cari kode/nama, centang bahan (maksimal 50; di atas itu diarahkan ke Per kelompok/Penuh).

**Pratinjau (dari server, baca-saja)** tampil sebelum tombol buat aktif: jumlah bahan masuk, bahan aktif total, per kelompok, **belum dikelompokkan (tetap ikut opname penuh)**, **nonaktif (tidak ikut)**, pengecualian, bahan tanpa catatan stok, bahan bersaldo minus, rincian per satuan, dan peringatan bila sudah ada sesi penuh aktif (hanya satu sesi penuh boleh berjalan: 409 `SESI_PENUH_AKTIF`).

**Cakupan disimpan di sesi:** server menurunkan daftar Material ID sendiri (klien tidak mengirim 358 ID) dan menyimpannya sebagai baris sesi + `scope_info` (parameter + ringkasan pratinjau). Perubahan master sesudahnya tidak mengubah cakupan.

**Bahan baru saat sesi berjalan:** bahan aktif yang memenuhi kriteria sesi tetapi tidak ada di sesi tampil sebagai **"di luar cakupan sesi"** (panel di halaman hitung) dengan dua tindakan eksplisit: *Tambahkan ke sesi* (baris `origin = TAMBAHAN`) atau *Abaikan* (alasan wajib, tercatat). Penyerahan hitungan ditahan (409 `CAKUPAN_BELUM_DIPUTUSKAN`) sampai semuanya diputuskan. Bahan yang dinonaktifkan di tengah sesi tetap di sesi (ditandai Nonaktif).

### 2.2 Halaman kerja hitung (`/warehouse/stock-count/:id/hitung`)
- Progres total (bar + teks) dan per kelompok (chip yang juga menyaring).
- Tab **Belum dihitung / Sudah dihitung / Perlu diperiksa** (+ Dikeluarkan bila ada); pencarian kode/nama; petugas dan waktu hitung per bahan.
- **Simpan bertahap** (tombol *Simpan perubahan* / *Simpan & berikutnya*): hanya mengirim baris yang berubah, sesi tidak diselesaikan, saldo tidak berubah. Baris belum disimpan ditandai "N belum disimpan"; peringatan sebelum menutup tab.
- **Kolom kosong = belum dihitung; `0` hanya bila diketik.** Tidak ada isian otomatis dari saldo; halaman ini tidak membawa saldo sama sekali.
- **Konflik dua petugas:** setiap baris punya `revision`. Simpan dengan revisi basi → `KONFLIK` per baris dengan angka terbaru + nama pengubah + waktu; petugas memilih *Pakai angka mereka* atau *Timpa* (alasan wajib). Tidak ada penimpaan diam-diam.
- **Koreksi sebelum diserahkan:** mengubah angka yang sudah tersimpan wajib beralasan; riwayat angka lama → baru, pelaku, waktu, alasan (peristiwa aktivitas; tampil di "Riwayat"). Bahan yang dikoreksi masuk tab *Perlu diperiksa*; petugas juga bisa menandai manual. Sesudah diserahkan, mengubah angka hanya lewat *Hitung ulang* (alur pemeriksaan yang ada).
- **HP (≤ 640 px):** satu kartu bahan (nama, kode, satuan, kolom jumlah besar, keyboard angka `inputmode=decimal`, font ≥ 16 px), bilah aksi tetap di dasar layar ("Sebelumnya", **"Simpan & berikutnya"**, "Lewati"), antrean dibekukan agar urutan tidak bergeser, mode *Daftar* sebagai alternatif.
- *Serahkan hitungan* aktif hanya bila semua bahan (non-dikeluarkan) sudah dihitung; bahan yang memang tidak ada dikeluarkan dari sesi dengan alasan atau diisi 0.
- Bahan boleh **dikeluarkan dari sesi** (alasan wajib, tercatat, bisa dikembalikan sebelum diserahkan).

### 2.3 Halaman sesi dan tinjauan (jendela fokus)
Cakupan tersimpan + progres + per kelompok. Untuk pemeriksa/penyetuju, per bahan: **jumlah fisik, waktu dan petugas hitung, saldo sistem sebanding PADA WAKTU ITU, ringkasan transaksi relevan selama sesi, dan selisih nyata**; alasan selisih (wajib) ditulis di sini; kotak cari untuk membuka bahan mana pun; filter "hanya berselisih / perlu diperiksa". Sesi lama (model 1) memakai tampilan lama dengan penanda "Sesi lama: cakupan N bahan dipilih manual — bukan sesi opname penuh baru".

## 3. Aturan waktu acuan (satu-satunya definisi)

1. Setiap hasil hitung punya `countedAt` = **waktu server saat angka itu terakhir disimpan**. Angka fisik dianggap menggambarkan gudang pada saat itu.
2. **Saldo sistem sebanding = Σ qty ledger bahan itu dengan `createdAt ≤ countedAt`** (di luar penyesuaian milik sesi ini). Dihitung dari ledger, tanpa snapshot awal.
3. Transaksi **sesudah** `countedAt`: tidak masuk pembanding (fisik belum memuatnya), tetap utuh di ledger → **tidak ada selisih palsu dan tidak terhitung dua kali**.
4. Transaksi **sebelum (`countedAt` − 30 menit)** dan sesudah sesi dimulai: sudah pasti ada di fisik → ikut pembanding otomatis, tanpa tanda.
5. Transaksi **di jendela ragu** (30 menit terakhir sebelum `countedAt`, sesudah sesi dimulai): mungkin belum tercermin di fisik (barang masuk rak persis saat dihitung). **Hanya ini** yang perlu ditandai pemeriksa (*sudah/belum masuk hitungan fisik*), memakai mekanisme tanda yang ada; "belum" = dikeluarkan dari pembanding. Selesaikan ditolak (409 `PERGERAKAN_SESI_BELUM_DITANDAI`) selama ada yang belum ditandai — hanya bahan itu yang menahan, bukan seluruh sesi.
6. Transaksi **sebelum sesi dimulai** sudah ada di ledger dan di fisik: ikut pembanding, tidak perlu tanda.
7. **Penyesuaian = fisik − pembanding**, ditulis **sekali** saat Selesaikan. Saldo akhir = ledger saat itu + penyesuaian = fisik + transaksi sesudah `countedAt`.
8. Mengubah angka (atau hitung ulang) menggeser `countedAt` bahan itu dan mereset tanda bahan itu serta pemeriksaan.
9. **Tidak ada pembekuan transaksi Gudang**: GR, Material Issue, Transfer berjalan normal selama opname.

Contoh teruji: bahan dengan ledger 100 dihitung 100; penerimaan resmi +20 terjadi sesudahnya → pembanding 100, selisih 0, saldo akhir 120. Bahan dengan penerimaan +5 sesaat sebelum dihitung dan fisik 100: ditandai "belum tercermin" → pembanding 100, selisih 0, ledger tetap 105 (pergerakan utuh); ditandai "sudah tercermin" → pembanding 105, selisih −5.

> **Keputusan untuk Owner:** lebar jendela ragu (30 menit) adalah konstanta `JENDELA_RAGU_MENIT`; bisa diubah satu angka. Lebih sempit = lebih sedikit tanda, lebih besar risiko selisih semu bila petugas menyimpan angka lama setelah barang masuk.

## 4. Pemeriksaan dan penyelesaian
- Pemeriksa ≠ penghitung/penugas (Opname Penuh wajib); penyetuju (Owner/Finance) ≠ pembuat/penugas/pengisi/pemberi tanda — **aturan lama, tidak diubah**. Catatan operasional: karena penanda pergerakan dan penulis alasan selisih dihitung sebagai "pengisi", keduanya dikerjakan **pemeriksa**, bukan penyetuju; bila penyetuju menulisnya, server menolak penyelesaian dengan pesan yang jelas.
- Penyelesaian membuat dampak stok **tepat sekali** (kunci baris sesi + status; pemanggilan ulang → `ulang:true`, tanpa penulisan), dengan satu peristiwa audit `DOCUMENT_POSTED`.
- Menyimpan hitungan, menutup layar, atau menyerahkan hitungan tidak mengubah saldo.
- Sesi lama tidak pernah ditafsirkan ulang (lihat 6).

## 5. Sebelum → sesudah

| | Sebelum | Sesudah |
|---|---|---|
| Menjadwalkan seluruh bahan aktif (358) | ≈ **1.077 interaksi** (3 per bahan: Tambah Item, buka dropdown, pilih; + buka dialog, jenis, Jadwalkan) | **3 klik**: buka dialog, pilih Opname penuh, buat sesi (terukur di browser) |
| Pratinjau cakupan | tidak ada | jumlah, kelompok, belum dikelompokkan, nonaktif, pengecualian |
| Cakupan tersimpan | daftar dari klien | dari server, disimpan di sesi |
| Mengisi hitungan | modal/tabel panjang, satu PATCH per baris | halaman kerja, simpan bertahap, kartu HP |
| Penimpaan antar petugas | diam-diam | konflik jelas per baris |
| Saldo pembanding | snapshot hari pertama | ledger pada waktu hitung tiap bahan |
| Transaksi selama sesi | tandai SEMUA | tandai hanya jendela ragu |
| Blind count | disembunyikan di layar | disaring di server |

Tangkapan layar sebelum/sesudah: `C:\tmp\km-gudang-iso\qa\opname-ba\` (desktop dan HP); seluruh QA: `C:\tmp\km-gudang-iso\qa\opname\{desktop,hp}\`.

## 6. Dampak API, skema, dan sesi lama

**Skema (aditif):** `stock_counts` + `model_version` (default 1), `scope_mode`, `scope_info` (jsonb); `stock_count_lines` + `counted_at`, `counted_by_id`, `revision` (default 0), `needs_check` (default false), `excluded_reason/at/by_id`, `origin` (default `SESI`). Tiga CHECK ringan. **Tanpa backfill, tanpa indeks/constraint unik baru** (tidak ada risiko gagal pada data lama). Production saat dibaca: 1 sesi (`CC-01092026-BASELINE`, SELESAI, FULL_STOCK_OPNAME, **106 baris**, 0 duplikat), 358 bahan aktif / 15 nonaktif; migrasi terakhir `20261220090000`.

**API baru** (`routes/stockCountSesi.js`, dipasang sebelum router lama): `POST /scope-preview`, `GET /bahan`, `POST /` (bila body memuat `mode`; selain itu diteruskan ke endpoint lama), `GET /:id/kerja`, `PUT /:id/hasil`, `GET /:id/lines/:lineId/riwayat`, `POST /:id/lines/:lineId/keluarkan|kembalikan`, `POST /:id/cakupan`. **Berubah untuk sesi model 2:** `start` tidak lagi snapshot saldo; `PATCH /:id/lines/:lineId` menolak `countedQty` (409, pakai `PUT /hasil`); `submit` menahan bahan belum dihitung/di luar cakupan; `complete` memakai pembanding per waktu hitung dan idempoten; `GET /:id` menyaring saldo untuk blind count dan membawa `tinjau` per baris; `GET /` ringkas (tanpa ratusan baris). **Tidak berubah:** semua endpoint untuk sesi model 1, aturan pemisahan tugas, ledger/jurnal/cutover Finance.

**Sesi lama:** tetap `model_version = 1`: snapshot saat Mulai, tanda semua pergerakan, PATCH per baris, tampilan lama + penanda "Sesi lama … bukan sesi opname penuh baru". Daftar menampilkan "dipilih manual (sesi lama)". Sesi 106 bahan tidak menghalangi, tidak dihitung, dan tidak dianggap sebagai Opname penuh 1 November.

**Implikasi rilis:** karena ada migrasi, rilis ini **bukan** web-saja: butuh skrip rilis yang memeriksa migrasi (pola Koreksi Gudang), backup, dan rehearsal terhadap restore. Skrip itu **belum dibuat** (permintaan: berhenti sebelum deploy). Rollback kode aman (kolom baru diabaikan kode lama); rollback skema tidak diperlukan.

## 7. Hasil pengujian

DB terisolasi (Postgres uji, **bukan production**), 360 bahan aktif + 15 nonaktif: 9 kelompok campur (Busa 100, Kain 80, Benang 40, Pegas 30, Aksesori 30, Lem 15, Lainnya 20, **belum dikelompokkan 45**), 6 satuan berbeda, **50 bahan tanpa catatan stok**, **10 bahan bersaldo minus**, 2 bahan Habis Pakai.

| Pengujian | Hasil |
|---|---|
| Integrasi baru `stockCountSesiPenuh` (cakupan & pratinjau, sesi penuh sekali pilih, 0 vs kosong, blind di server, dua petugas/revisi, **waktu acuan** sebelum/sesudah/jendela ragu, bahan baru di luar cakupan, sesi lama 106 bahan, izin baca-saja + 200 baris sekali simpan, **Penerimaan & Material Issue resmi saat sesi berjalan**, Selesaikan tepat sekali) | **11/11** |
| Unit baru `opnameSesi` (klasifikasi waktu, pembanding, progres, cakupan) | **4/4** |
| Regresi integrasi (Gudang, Koreksi, stok/opname/cutover/rekon, Retur Supplier, Produksi MI/QC/antrean, Finance persediaan/koreksi) | **36 berkas, 361 tes, 360 lulus, 1 gagal** — `financeFase1ResiInventory` ("kas masuk di buku"), **gagal identik pada baseline live `cb33a07d`** (bergantung tanggal; muncul setelah pergantian hari), tidak terkait perubahan ini |
| Unit backend | 1699 tes, 1691 lulus, 6 gagal — semuanya berkas yang tidak disentuh (COVERAGE TAB, compose staging ×2, pin skrip atribusi, audit P5, serta uji skrip rilis/audit statis yang kadang gagal saat suite penuh dan **lulus bila dijalankan sendiri**). Satu tes rilis lama (Koreksi Gudang) memang diperbarui: tidak boleh lagi menganggap tidak ada migrasi sesudahnya |
| Frontend | 1202 tes, 1193 lulus, 9 gagal **lama yang sama dengan baseline**; tes baru `gudangOpnameSesi` 6/6 |
| **Browser nyata, desktop 1440 px** (`flows9.mjs`) | **59/59** |
| **Browser nyata, HP 390 px** | **49/49** |

Yang dicakup browser: tiga pilihan cakupan + pratinjau (per kelompok 140 bahan, Cycle Count lewat pencarian + checkbox 3 bahan, **opname penuh 360 bahan tepat 3 klik**); sesi penuh kedua ditolak; sesi lama tampil "dipilih manual (sesi lama)" dengan penanda; halaman sesi → Mulai hitung → halaman hitung; **0 eksplisit tersimpan 0, kolom kosong tetap belum dihitung**; simpan sebagian, keluar lalu lanjut (progres bertahan); koreksi tanpa alasan ditolak, dengan alasan masuk Perlu diperiksa; riwayat angka; tab, pencarian, filter kelompok, Enter pindah baris; **dua petugas** (konflik dengan nama + angka terbaru, Pakai angka mereka, Timpa beralasan, riwayat 3 entri); bahan baru → di luar cakupan → Tambahkan; bahan dikeluarkan; Serahkan dinonaktifkan sampai semua terisi; **transaksi sesudah dihitung tidak membuat selisih palsu**; selisih nyata; jendela ragu ditolak sampai ditandai; pemeriksa ≠ penyetuju; **penyelesaian tepat sekali (klik ganda = satu rangkaian penyesuaian)**; saldo akhir (fisik + transaksi sesudah hitung); akun baca-saja; HP: satu kartu bahan, keyboard angka (inputmode decimal, font 16 px, tinggi ≥ 44 px), "Simpan & berikutnya", Lewati, bilah aksi tetap, tanpa scroll horizontal. Tangkapan layar: `C:\tmp\km-gudang-iso\qa\opname\{desktop,hp}\`.

**Temuan selama QA yang sudah diperbaiki:** ID pengguna bukan UUID (kolom pelaku diubah ke teks); progres per kelompok selalu "Belum dikelompokkan" karena `itemGroup` tidak ikut di query detail; baris hitung desktop terlalu tinggi (aksi sekunder dilipat di "Lainnya"); di HP tombol utama di bawah lipatan (dipindah ke bilah tetap di dasar layar); kotak cari ditambahkan di tinjauan agar pemeriksa bisa membuka bahan mana pun.

**Batas pengujian yang jujur:** Chrome headless terhadap DB terisolasi; **belum di perangkat fisik** (Android/iOS), **belum dengan petugas sungguhan**, belum dengan jaringan gudang yang putus-sambung (tidak ada mode offline: angka yang belum disimpan hanya ada di layar dan diberi peringatan sebelum menutup tab). Tidak ada sesi opname dibuat dan tidak ada tulisan ke production.

## 8. Komponen lama yang aman dihapus kemudian
- `features/warehouse/components/StockCountFormModal.jsx` (modal lama; tidak lagi diimpor halaman daftar). Jangan dihapus sebelum tes kontrak yang membacanya diperbarui.
- Jalur `lines:[…]` di `POST /inventory/stock-counts` tetap dipertahankan untuk kompatibilitas (dipakai skrip dan tes sesi lama).
- **Jangan hapus:** `muatPergerakanSesi`/`selisihTersesuaikan` (dipakai sesi model 1 dan jendela ragu), `identitasHitung`, `opnameCutover`.

## 9. Keputusan
- **Kandidat:** SHA ujung branch `feat/gudang-opname-penuh` (lihat laporan). Dasar: live `cb33a07d`.
- **GO untuk dipakai pada opname 1 November — dengan syarat; NO-GO untuk rilis hari ini.** Alasan: kandidat membawa **migrasi** (tidak bisa memakai jalur web-saja) dan perubahan perilaku penyelesaian untuk sesi baru. Syarat sebelum rilis:
  1. **Skrip rilis bergerbang dengan migrasi** (pola Koreksi Gudang: backup, pin migrasi, rehearsal terhadap restore backup nyata — termasuk memastikan sesi lama `CC-01092026-BASELINE` 106 baris tetap terbaca dan 358 bahan aktif membentuk sesi penuh 358 baris) — belum dibuat.
  2. **Keputusan Owner:** lebar jendela ragu 30 menit; bahwa penanda pergerakan dan alasan selisih dikerjakan pemeriksa (aturan pemisahan tugas yang ada, tidak diubah); apakah Habis Pakai (non-inventory) dikecualikan dari opname penuh (bawaan: ikut).
  3. **Latihan pada salinan data** (rehearsal/staging, bukan production): satu putaran dengan dua petugas di HP fisik. Jangan membuat sesi di production sebelum hari opname.
  4. Cek ulang baseline live saat rilis; target rilis paling lambat sekitar 27 Oktober agar ada ≥ 3 hari latihan sebelum 1 November.
- **NO-GO bila:** baseline live bergeser ke berkas Stock Count/ledger, ada migrasi lain yang bentrok urutan, atau rehearsal terhadap restore menunjukkan sesi lama tidak terbaca.
- **Risiko residual:** tidak ada mode offline di HP; satu antrean kunci per sesi saat simpan (simpan 200 baris < 15 dtk di uji, jauh lebih cepat pada penggunaan nyata); lebar jendela ragu adalah kebijakan, bukan fakta data; hitungan desimal memakai pembulatan 4 angka seperti ledger.
