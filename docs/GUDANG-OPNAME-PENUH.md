# Stock Opname Penuh — model waktu opname, cakupan "saldo dilacak fisik", dan rilis

Branch `feat/gudang-opname-penuh` (dari live `cb33a07d`). **Belum deploy. Tidak ada sesi opname dibuat di production. Data production hanya dibaca (SELECT, transaksi read-only).**
Kandidat ini membawa **SATU migrasi aditif** (`20261222090000_stock_count_sesi_penuh`) dan **skrip rilis bergerbang** (`scripts/release-opname-penuh.sh`) — lihat bagian 7–8.

> **Revisi ini menggantikan model waktu versi sebelumnya (`ef8acaf2`).** Masalahnya: `countedAt` = waktu angka *disimpan*, bukan waktu barang *dihitung*; dan penanda pergerakan memakai jendela tetap 30 menit yang bisa melewatkan transaksi relevan. Keduanya dibuang. Bagian 3 adalah satu-satunya definisi aturan waktu.

## 1. Audit kontrak Stock Count yang ada (sebelum diubah)

| Hal | Perilaku lama | Akibat untuk opname penuh |
|---|---|---|
| Membuat sesi | `POST /inventory/stock-counts` dengan `lines:[{materialId}]` dari klien; modal menambah bahan satu per satu. | Menjadwalkan ±358 bahan ≈ **1.077 interaksi**; tidak ada pratinjau, tidak ada cakupan tersimpan. |
| Saldo sistem | `systemQty` direkam **sekali untuk semua baris saat Mulai hitung**. | Sesi berhari-hari membandingkan fisik hari ke-3 dengan saldo hari ke-1. |
| Transaksi selama sesi | Semua pergerakan sesudah `startedAt` **ditandai satu per satu**. | Pada sesi penuh jumlahnya bisa ratusan. |
| Hasil hitung | `PATCH` satu baris per permintaan, tanpa revisi, tanpa waktu/petugas per baris. | Dua petugas bisa saling menimpa diam-diam; tidak ada waktu pengamatan per bahan. |
| Blind count | Saldo hanya disembunyikan **di layar**. | Disaring di server untuk sesi baru. |
| Selesaikan | Pemanggilan kedua → 400. | Idempoten untuk sesi baru (`ulang:true`). |
| Pemisahan tugas | Penyetuju ≠ pembuat/penugas/pengisi/pemberi tanda; Opname Penuh wajib diperiksa petugas lain. | **Tidak diubah.** |

**Fakta ledger yang menentukan desain (diuji, bukan diasumsikan):** `stock_movements.created_at` adalah waktu **INSERT** (diuji: ≈1,5 dtk setelah transaksi mulai), dan INSERT terjadi **di bawah kunci baris bahan** (`postStockMovement` → `lockMaterialBalance`). Jadi urutan posting per bahan monoton dan tidak butuh kolom/migrasi di tabel ledger. Ledger **tidak** punya tanggal kejadian sendiri; hanya sebagian dokumen punya (Penerimaan: tanggal tiba/tanggal terima; Material Issue, Transfer, dll. hanya waktu aksi).

## 2. Rancangan final — membuat sesi dan halaman kerja

### 2.1 Membuat sesi (dialog "Jadwalkan Stock Opname")
Tiga pilihan (tanpa pilihan bawaan): **Opname penuh** (sekali pilih), **Per kelompok** (centang kelompok), **Cycle Count** (cari + centang, maks. 50). Pratinjau dari server, baca-saja, tampil sebelum tombol buat aktif: jumlah bahan masuk, bahan aktif, per kelompok, belum dikelompokkan, nonaktif, **bahan tidak dilacak + alasannya**, bahan tanpa catatan stok, saldo minus, per satuan. Hanya satu sesi penuh boleh berjalan (409 `SESI_PENUH_AKTIF`). Daftar Material ID diturunkan server dan **disimpan di sesi**; perubahan master sesudahnya tidak mengubah cakupan (bahan baru yang memenuhi kriteria tampil "di luar cakupan sesi": Tambahkan / Abaikan beralasan; Serahkan ditahan sampai diputuskan).

### 2.2 Cakupan Opname Penuh = bahan aktif yang saldonya DILACAK secara fisik
Master bahan **tidak punya flag** "dilacak fisik" dan keputusan **tidak diambil dari nama kategori**. Dasarnya adalah **bukti** (`services/stokFisik.js`, satu fungsi, dipakai pratinjau, pembuatan sesi, "di luar cakupan", rehearsal, dan perkiraan di skrip rilis). Bahan aktif **dilacak** bila punya ≥ 1 jejak:

| Jejak | Arti |
|---|---|
| `CATATAN_LEDGER` | ada pergerakan di `stock_movements` |
| `NILAI_REFERENSI` | ada nilai/harga referensi stok dari berkas stock opname Excel |
| `TITIK_PESAN` | titik/jumlah pesan ulang diatur |
| `JENIS_SKU` | didaftarkan lewat SKU baru sebagai item stok (`kind`) |
| `DOKUMEN_GUDANG` | muncul di Penerimaan, Material Issue, Transfer, atau Riwayat Referensi |
| `PERNAH_DIHITUNG` | pernah diberi angka hasil hitung pada sesi Stock Count yang tidak dibatalkan |
| `BOM_PRODUKSI` | dipakai di BOM Produksi |

Bahan aktif **tanpa satu pun jejak** = **tidak dilacak**: tampil di pratinjau dengan alasan ("Tidak ada jejak stok: …"), **tidak ikut** bawaan, tetapi bisa **diikutkan per bahan dengan alasan wajib** (mis. "ada barangnya di rak C"; tombol buat tetap nonaktif sampai alasan diisi). Habis Pakai **ikut bila berjejak stok** dan tidak ikut bila tanpa jejak — kategori tidak menentukan (teruji: Habis Pakai berjejak ikut, Habis Pakai tanpa jejak tidak). Cycle Count boleh memilih bahan tak dilacak, dengan peringatan. Bahan nonaktif tidak pernah ikut. Bahan yang di tengah sesi memperoleh jejak (mis. ada pergerakan) muncul sebagai "di luar cakupan" untuk diputuskan.

**Data production (dibaca read-only, 20 Okt 2026):** 358 bahan aktif → **279 dilacak**, **79 tidak dilacak** (77 Bahan Baku + 2 Barang Jadi); 137 punya catatan ledger; ketiga Habis Pakai aktif berjejak (ikut). **Artinya sesi penuh bawaan hari ini = 279 bahan, bukan 358** — 79 bahan master tidak punya catatan stok, nilai referensi, dokumen, BOM, maupun riwayat hitung. Daftar lengkapnya tampil di pratinjau; **Owner perlu menilainya sebelum 1 November** (bisa saja ada yang barangnya memang ada di rak dan harus diikutkan). Solusi permanen (flag eksplisit di master) bukan bagian rilis ini.

### 2.3 Halaman kerja hitung (`/warehouse/stock-count/:id/hitung`)
- Progres total dan per kelompok; tab **Belum dihitung / Sudah dihitung / Tanpa waktu hitung** (muncul bila ada) **/ Perlu diperiksa** (+ Dikeluarkan); pencarian; simpan bertahap; kolom kosong = belum dihitung, `0` hanya bila diketik; konflik dua petugas lewat `revision` per baris; koreksi wajib alasan; HP satu kartu bahan + bilah aksi tetap.
- **Aturan sederhana untuk petugas (HP dan desktop):**
  1. Tekan **Mulai hitung** pada bahan **tepat sebelum menghitung barangnya** (desktop: juga **Mulai hitung semua yang tampil** untuk satu rak). Waktunya dicap server di bawah kunci bahan.
  2. Terlanjur menghitung tanpa menekan? Saat **Simpan**, muncul pertanyaan **"Kapan barang ini dihitung?"** — *Baru saja dihitung* / *Pilih jam* / *Belum tahu — simpan tanpa waktu*. Tidak ada pilihan yang diisi diam-diam.
  3. Salah waktu? **Ubah waktu** di baris bahan: wajib alasan, tercatat (siapa, kapan, lama → baru).
  4. Mengoreksi angka: centang **Salah ketik — waktu hitung tidak berubah** (bawaan). Tidak dicentang = hitung ulang: ditanya waktu hitung barunya.
- *Serahkan hitungan* aktif hanya bila semua bahan terisi **dan semua punya waktu hitung**.

### 2.4 Halaman sesi dan tinjauan (jendela fokus)
Per bahan: **Jumlah fisik · Dihitung (pengamatan) · Disimpan · Saldo sistem saat dihitung · Selisih**, lalu **seluruh pergerakan sejak bahan dihitung** (tiap baris: jenis, jumlah, dokumen, **waktu diposting**, tanggal kejadian dokumen bila ada, **kelas**, keputusan). Pemeriksa memutuskan per pergerakan *Sudah ikut terhitung di fisik* / *Belum ikut terhitung*, atau massal untuk kelas yang aman. Pencarian membuka bahan mana pun.

## 3. Model waktu opname (satu-satunya definisi)

### 3.1 Tiga waktu, disimpan dan ditampilkan terpisah
| Waktu | Arti | Sumber |
|---|---|---|
| **Dihitung** (`observed_at`) | kapan barang diamati secara fisik | `MULAI` (tombol Mulai hitung, cap server di bawah kunci bahan) · `DINYATAKAN` (petugas menyatakan saat menyimpan / mengisi) · `DIKOREKSI` (diubah kemudian, wajib alasan) |
| **Disimpan** (`saved_at`) | kapan angka masuk sistem | server |
| **Diposting** (`stock_movements.created_at`) | kapan transaksi ledger diposting | ledger (tidak diubah) |

**Waktu dihitung yang tidak diketahui = `NULL`, tidak pernah diturunkan dari waktu simpan.** Hitungan tanpa waktu dapat disimpan (ditandai "Waktu hitung belum diketahui"), tetapi **tidak bisa diserahkan atau diselesaikan** (409 `WAKTU_HITUNG_BELUM_DIKETAHUI`) dan tidak punya pembanding sampai waktunya dinyatakan/dikoreksi. Waktu yang dinyatakan wajib tidak di masa depan (toleransi 1 menit jam perangkat) dan tidak sebelum sesi dimulai. Perubahan waktu masuk jejak (`WAKTU_HITUNG_DICATAT`: lama → baru, sumber, pelaku, alasan), **mereset keputusan pergerakan bahan itu dan membatalkan pemeriksaan** yang sudah ada. Mengganti angka yang sudah tersimpan tanpa waktu baru dan tanpa "salah ketik" → waktu kembali tidak diketahui.

### 3.2 Pembanding dan pergerakan sejak pengamatan (tanpa jendela tetap)
- Pergerakan yang **diposting sebelum `observed_at`** (`created_at <` strict) sudah ada saat barang dihitung → otomatis masuk pembanding. Tidak ada batas menit: transaksi 20 menit atau 5 jam sebelum pengamatan diperlakukan sama.
- **SELURUH pergerakan bahan itu yang diposting pada/sesudah `observed_at` sampai penyelesaian ditandai** dan wajib diputuskan pemeriksa (*sudah* / *belum* ikut terhitung di fisik). Tiap tanda berkelas:

| Kelas | Arti | Boleh massal? |
|---|---|---|
| `SERENTAK` | diposting tepat di milidetik pengamatan (urutan tidak pasti; tidak diputuskan diam-diam) | tidak |
| `SAAT_HITUNG` | diposting antara pengamatan dan angka disimpan (barang sedang dihitung) | tidak |
| `BERTANGGAL_MUNDUR` | diposting belakangan, tetapi **tanggal kejadian dokumen** (tanggal tiba/terima Penerimaan) pada atau sebelum hari pengamatan (WIB) → fisiknya mungkin sudah ada saat dihitung | tidak |
| `SESUDAH_DISIMPAN` | diposting sesudah angka disimpan dan tidak bertanggal mundur | **ya** — hanya "belum ikut terhitung", per pergerakan tetap tercatat (pelaku + waktu) |

- **pembanding = Σ ledger diposting sebelum pengamatan + Σ pergerakan yang diputuskan "sudah ikut terhitung"**. Pergerakan yang belum diputuskan **tidak** masuk pembanding secara diam-diam dan **menahan Selesaikan** (409 `PERGERAKAN_SESI_BELUM_DITANDAI`).
- **Penyesuaian = fisik − pembanding**, ditulis **sekali** saat Selesaikan. **Saldo akhir = fisik + Σ pergerakan yang diputuskan "belum ikut terhitung"** (diuji sebagai invarian).
- Bukti per bahan (tiga waktu, saldo sebelum pengamatan, tiap pergerakan beserta kelas dan keputusan) disimpan di peristiwa audit `DOCUMENT_POSTED`.
- Tanggal kejadian hanya ada untuk Penerimaan; dokumen lain tidak punya tanggal kejadian sendiri sehingga mengikuti waktu posting. Catatan praktis: *Simpan ke Stok* mengisi tanggal terima = hari ini bila kosong, sehingga Penerimaan yang diposting di hari yang sama sesudah bahan dihitung selalu berkelas `BERTANGGAL_MUNDUR` (diputuskan satu per satu) — disengaja: Penerimaan adalah kasus "sudah di rak tetapi baru diposting".

### 3.3 Pemeriksa, penyetuju, dan transaksi tetap berjalan
- **Pemeriksa menyelesaikan tanda; penyetuju tetap orang berbeda.** Penanda, penulis alasan selisih, dan pengoreksi waktu dihitung sebagai "pengisi": mereka tidak bisa menjadi penyetuju selisih. Pemeriksa ≠ penghitung (Opname Penuh wajib). **Aturan pemisahan tugas tidak diubah.**
- **Gudang tidak dibekukan.** Penerimaan/Material Issue/Transfer berjalan normal. Hanya saat **Selesaikan** (detik) semua bahan sesi dikunci berurutan id; pembanding dibaca **sesudah** kunci didapat. Transaksi yang commit lebih dulu terlihat (dan menahan sampai diputuskan); yang menunggu kunci bercap waktu sesudah penyelesaian dan tidak mengubah hasil. Tidak ada saldo basi.

### 3.4 Kasus yang diuji (DB terisolasi)
| Kasus | Hasil |
|---|---|
| Dihitung 10.00, angka disimpan 10.40 (jeda > 30 menit), GR diposting 10.05 | GR berkelas `SAAT_HITUNG`, **tidak masuk pembanding fisik 10.00**; tiga waktu terpisah; keputusan pemeriksa menentukan; transaksi 20 menit *sebelum* pengamatan tidak perlu ditandai |
| Dihitung lalu Material Issue sesudahnya (resmi) | `SESUDAH_DISIMPAN`, diputuskan massal; saldo akhir = fisik + MI (juga untuk bahan berselisih) |
| Dokumen diposting belakangan bertanggal mundur (GR bertanggal kemarin) | `BERTANGGAL_MUNDUR`, tanggal kejadian tampil, **tidak bisa massal**; "sudah ikut terhitung" mencegah hitung ganda (saldo = fisik; tanpa keputusan itu akan 140) |
| Dua transaksi + Selesaikan bersamaan | Selesaikan **menunggu kunci**, tidak memakai saldo basi, menolak sampai pergerakan yang baru commit diputuskan; stres 4 posting + Selesaikan: saldo akhir = fisik + posting, **tepat satu penyesuaian per bahan** |
| Klik ganda | Mulai hitung: `SUDAH_DIMULAI` (waktu tidak bergeser); Simpan: konflik revisi; tanda massal: 0 kedua kali; Selesaikan: `ulang:true`, satu audit |
| Waktu tidak diketahui / koreksi | tidak dikarang; serah/selesai ditolak; masa depan & sebelum-sesi ditolak; alasan wajib; tanda direset; pemeriksaan batal |
| Mulai hitung di bawah kunci | transaksi yang sedang diposting commit dulu → `SEBELUM_PENGAMATAN`; yang menyusul ditandai |
| Tepat di milidetik pengamatan | `SERENTAK`, wajib diputuskan |

## 4. Sebelum → sesudah
| | Sebelum | Sesudah |
|---|---|---|
| Menjadwalkan seluruh bahan aktif | ≈ **1.077 interaksi** | **3 klik** (terukur di browser) |
| Waktu acuan hitung | tidak ada / waktu simpan | **tiga waktu terpisah**, waktu hitung dari petugas (Mulai hitung / dinyatakan / dikoreksi) |
| Transaksi yang dianggap relevan | semua sejak mulai sesi, atau jendela 30 menit | **semua sejak bahan dihitung**, berkelas, diputuskan pemeriksa |
| Cakupan Opname Penuh | semua aktif / pilihan manual | **bahan dilacak (bukti)**; tak dilacak tampil + alasan; bisa diikutkan |
| Penimpaan antar petugas | diam-diam | konflik jelas per baris |
| Blind count | disembunyikan di layar | disaring di server |

Tangkapan layar: `C:\tmp\km-gudang-iso\qa\opname\{desktop,hp}\` (dialog waktu, tanpa waktu, tinjauan, selesai); sebelum/sesudah UX awal: `C:\tmp\km-gudang-iso\qa\opname-ba\`.

## 5. Dampak API dan skema

**Skema (aditif, 1 migrasi, belum pernah dirilis sehingga direvisi di tempat):** `stock_counts` + `model_version` (NOT NULL DEFAULT 1), `scope_mode`, `scope_info`; `stock_count_lines` + `saved_at`, `counted_by_id`, **`observed_at`, `observed_source`, `observed_by_id`, `observed_recorded_at`**, `revision` (DEFAULT 0), `needs_check` (DEFAULT false), `excluded_reason/at/by_id`, `origin` (DEFAULT `SESI`); **5 CHECK ringan** (model_version ∈ {1,2}; scope_mode; origin; observed_source; `observed_at` dan `observed_source` NULL bersama-sama). Tanpa tabel/indeks/FK/trigger baru, tanpa backfill, **tanpa menyentuh `stock_movements`**; NOT NULL hanya dengan DEFAULT konstan (PostgreSQL ≥ 11: tanpa rewrite tabel). `counted_at` (versi lama) dihapus dan diganti `saved_at`.

**API baru / berubah** (`routes/stockCountSesi.js` dan `routes/stockCount.js`):
- baru: `POST /:id/lines/mulai` (cap waktu server di bawah kunci bahan, idempoten), `POST /:id/lines/:lineId/waktu` (koreksi beralasan), `POST /:id/pergerakan/tanda-massal` (hanya `tercermin:false`, hanya kelas `SESUDAH_DISIMPAN`), `GET /:id/lines/:lineId/riwayat` kini memuat entri angka **dan** waktu.
- `PUT /:id/hasil`: item boleh membawa `observedAt` (dinyatakan) / `waktuTetap`; respons membawa `observedAt`, `savedAt`, `tanpaWaktu`; `GET /:id/kerja` membawa tiga waktu per baris.
- `GET /:id` (tinjauan): per bahan `saldoSebelum`, `pembanding`, `selisih`, `waktuTidakDiketahui`, `transaksi.sejakPengamatan[]` (kelas, tanggal kejadian, dokumen, keputusan).
- `scope-preview` / `POST /`: `ikutkanTakDilacak` + `ikutkanAlasan`; ringkasan memuat `dilacak`, `tidakDilacak{daftar, alasan}`, `dasarCakupan`, `peringatanItems`. `excludeJenis` tetap didukung API tetapi **tidak ada lagi di UI**.
- `POST /:id/submit` dan `POST /:id/complete`: gerbang `WAKTU_HITUNG_BELUM_DIKETAHUI` dan keputusan pergerakan; `complete` membaca pembanding sesudah semua kunci bahan.
- **Tidak berubah:** semua endpoint sesi model 1, ledger posting (`inventoryLedger.js`), pemisahan tugas (`inventorySegregation.js`), identitas hitung, jurnal/cutover Finance.

**Sesi lama:** tetap `model_version = 1` (snapshot saat Mulai, tanda semua pergerakan, PATCH per baris, tampilan lama + penanda "Sesi lama … bukan sesi opname penuh baru"). Production: **1 sesi** (`CC-01092026-BASELINE`, COMPLETED, 106 baris) — tidak ditafsirkan ulang sebagai opname penuh 1 November.

## 6. Hasil pengujian (ulang pada DB terisolasi, bukan production)

DB terisolasi: 360 bahan aktif berjejak + 15 nonaktif (9 kelompok campur, 6 satuan, 50 tanpa catatan stok, 10 saldo minus) + bahan tak berjejak untuk uji cakupan.

| Pengujian | Hasil |
|---|---|
| Integrasi `stockCountSesiPenuh` (18 tes: pratinjau, sesi penuh sekali pilih, 0 vs kosong, blind di server, dua petugas/revisi, **KASUS 1–4**, Mulai hitung di bawah kunci, waktu tidak diketahui + koreksi, tanda direset, serentak, **cakupan dilacak**, cakupan berubah, sesi lama 106 bahan, baca-saja + 200 baris, **Penerimaan & MI resmi**) | **18/18** |
| Unit `opnameSesi` (klasifikasi tanpa jendela, pembanding, invarian saldo akhir, progres, cakupan, sinyal stok) | **6/6** |
| Unit frontend `gudangOpnameSesi` (waktu tidak dikarang, perluWaktu, terapkanHasilMulai, teks tiga waktu, struktur) | **10/10** |
| Tes rilis `releaseOpnamePenuh` (pin migrasi, pemindai + mutan, gerbang, rehearsal, uji perilaku, smoke baca-saja, guard) | **13/13** |
| Regresi integrasi (36 berkas Gudang/Koreksi/stok/opname/cutover/Retur/Produksi/Finance) | @@REGRESI@@ |
| Unit backend / frontend penuh | @@UNIT@@ |
| **Browser nyata, desktop 1440 px** (`flows10.mjs`) | **75/75** |
| **Browser nyata, HP 390 px** | **61/61** |
| Skrip rilis: sintaks bash; **32 mutan migrasi** ditolak di bash nyata; potongan SQL (sidik jari, struktur, uji perilaku, perkiraan cakupan) diuji ke Postgres lokal | @@SQL@@ |

**Temuan QA yang diperbaiki:** pratinjau server menolak "ikutkan" tanpa alasan sehingga panel (dan kolom alasannya) hilang — pratinjau memakai alasan sementara, pembuatan sesi tetap wajib alasan asli; panel keputusan tetap tampil "0 menunggu" sesudah semuanya diputuskan; mutan pemindai pada skrip rilis tidak mengubah migrasi multi-baris (akan membuat rilis berhenti salah) — diganti; riwayat baris kini juga memuat entri waktu (harness disesuaikan).

**Batas pengujian yang jujur:** Chrome headless terhadap DB terisolasi; **belum di perangkat fisik**, **belum dengan petugas sungguhan**, belum dengan jaringan putus-sambung (tidak ada mode offline). `created_at` ledger berasal dari jam aplikasi (satu proses); selisih jam antar-proses (mis. saat tumpang-tindih rilis) bernilai milidetik dan, bila persis sama, ditangani sebagai `SERENTAK`. Rehearsal restore **di VPS belum dijalankan** (menulis backup + DB sementara di server production; menunggu izin) — logikanya diuji lokal seperti di atas.

## 7. Skrip rilis bergerbang (`scripts/release-opname-penuh.sh`)

Diturunkan dari pola Koreksi Gudang: generator `scripts/gen-release-opname-penuh.cjs` + templat + pustaka (`scan-migrasi`, `rehearsal-kode`, `smoke`) + `rollback-guard-opname-penuh.sh`; **semua nilai bergantung commit dihitung dari git** (allowlist 35 berkas, pin sha256 migrasi, pin diff `schema.prisma`, hasil pemindai DDL, commit live wajib leluhur, berkas pelindung identik dengan live: ledger posting, pemisahan tugas, identitas hitung, jurnal, otorisasi, Penerimaan, Material Issue, opname cutover, Produksi override).

Urutan: **(1)** gerbang sumber (ancestry, allowlist, pin migrasi, **pemindai DDL fail-closed + 32 mutan negatif**, tepat 1 migrasi pending, migrasi baseline tidak boleh berubah) → **(2)** audit production baca-saja + sidik jari (16 kelompok termasuk sesi hitung lama) + perkiraan cakupan → **(3)** backup + checksum → **(4)** build web + image → **(5)** REHEARSAL: restore **nyata** ke DB sementara, migrasi dengan image baru, struktur 15 kolom + 5 CHECK, uji perilaku (6 penolakan + 4 sah, dibatalkan), **kode baru terhadap data restore** (sesi 106 baris tetap terbaca; setiap bahan aktif terklasifikasi masuk/tidak dilacak), sidik jari SEMUA tabel sebelum = sesudah → **(6)** `migrate deploy` production SATU kali (backend lama tetap melayani) → **(7)** switch → **(8)** verifikasi + smoke baca-saja (izin, sesi lama terbaca, pratinjau cakupan atas bahan nyata, tidak ada tulisan). Mode `--preflight-only` (baca-saja penuh) dan `--rehearsal-only` (backup + DB sementara, tanpa build/migrasi/switch).

**Rollback kode:** aman selama **tidak ada sesi model baru yang terbuka** (SCHEDULED / IN_PROGRESS / WAITING_REVIEW) — kode lama tidak mengenal sesi itu dan menulis penyesuaian keliru dari snapshot kosong. `rollback-guard-opname-penuh.sh` (baca-saja) menolak selama ada sesi terbuka. Rollback **tidak** menghapus kolom/hasil hitung/penyesuaian; migrasi aditif aman dibiarkan terpasang.

## 8. Komponen lama yang aman dihapus kemudian
- `features/warehouse/components/StockCountFormModal.jsx` (tidak lagi diimpor halaman daftar; jangan hapus sebelum tes kontrak yang membacanya diperbarui).
- Jalur `lines:[…]` di `POST /inventory/stock-counts` tetap untuk kompatibilitas (skrip, tes sesi lama).
- **Jangan hapus:** `muatPergerakanSesi`/`selisihTersesuaikan` (sesi model 1), `bacaTandaSesi`, `identitasHitung`, `opnameCutover`.

## 9. Keputusan
- **Kandidat:** SHA ujung branch `feat/gudang-opname-penuh` (lihat laporan). Dasar: live `cb33a07d`.
- **Keputusan GO/NO-GO:** lihat laporan akhir (ditulis setelah suite penuh dan preflight).
- **Keputusan Owner yang tersisa:** (1) menilai **79 bahan tidak dilacak** (apakah ada yang harus diikutkan); (2) bahwa penanda pergerakan, alasan selisih, dan koreksi waktu dikerjakan **pemeriksa**, bukan penyetuju (pemisahan tugas yang ada); (3) kebijakan Penerimaan bertanggal mundur diputuskan satu per satu.
- **Risiko residual:** tidak ada mode offline di HP; petugas yang menekan Mulai hitung *sesudah* menghitung menggeser pengamatan lebih lambat dari kenyataan (dilindungi: pemeriksa melihat jeda dihitung↔disimpan dan bisa mengoreksi beralasan); keputusan pemeriksa bergantung penilaian manusia (dicatat per pergerakan); 79 bahan tak berjejak bergantung keputusan Owner.
