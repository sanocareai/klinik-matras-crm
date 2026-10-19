# UX Gudang Tahap 3 — Kelompok bahan, pipeline Penerimaan, jendela fokus, sidebar

Branch `feat/gudang-ux-tahap3` (dari baseline live `ca9bdea7`, Tahap 2 + perbaikan pintu masuk). **Belum dideploy.** Tanpa migrasi, tanpa perubahan skema, tanpa perubahan dependensi.
Tujuan: pencarian bahan, penerimaan barang, dan navigasi Gudang lebih cepat dipahami petugas harian.

## 1. Stok & Lokasi berdasarkan kelompok bahan

### Audit data master material (production, baca-saja, 18–19 Okt 2026)
| Dimensi | Sumber | Keadaan |
|---|---|---|
| **Jenis persediaan** (Bahan Baku / Setengah Jadi / Barang Jadi / Habis Pakai) | `Material.category` (enum, sudah terisi semua) | 373 bahan: Bahan Baku 344, Barang Jadi 25, Habis Pakai 4, Setengah Jadi 0, tanpa kategori 0. Layak dipakai apa adanya. |
| **Kelompok bahan operasional** (Busa, Kain, Benang, Pegas, Kayu, Lem/Kimia, Aksesori, Lainnya) | **Tidak ada field khusus.** Yang ada: `Material.itemGroup` (teks bebas dari kolom "BARANG" stock opname Excel) | 59 nilai berbeda; 358 bahan punya nilai, 15 bahan (semuanya nonaktif, seed lama) kosong. Nilai ber-huruf berbeda: KAIN/Kain, SUPPORT/Support, LEM/Lem. |

`itemGroup` **memadai untuk mayoritas** bahan tetapi bukan field yang bersih: beberapa grup berisi bahan campuran (mis. SUPPORT KAIN memuat resleting dan benang; KANCING memuat kain; SUPPORT memuat skrup, kaki, ring). Karena itu kelompok **tidak ditetapkan permanen dan tidak ditebak dari nama**.

### Pendekatan yang dikirim (tanpa migrasi)
- `backend/src/constants/kelompokBahan.js`: tabel EKSPLISIT itemGroup → kelompok (huruf besar/kecil dan spasi diabaikan), hanya untuk grup yang artinya jelas. Grup campuran/kosong/belum dikenal → **Belum dikelompokkan** dengan alasan yang terbaca.
- `services/stokLokasi.js` menambah per baris `itemGroup` + `kelompok { kode, label, sumber, alasan? }` dan ringkasan `kelompok` (per kelompok DAN per jenis: total aktif, diketahui, belum diketahui, minus, nol, nonaktif). Turunan, read-only, tidak disimpan.
- Pemetaan (audit `node backend/scripts/audit-kelompok-bahan.mjs materials.tsv`): Busa 133 · Kain 56 · Benang 1 · Pegas 11 · Kayu 14 · Lem/Kimia 6 · Aksesori 24 · Lainnya 84 · **Belum dikelompokkan 44 (29 aktif)**.
  "Lainnya" hanya untuk grup yang jelas bukan tujuh kelompok lain (PE, plastik, cotton sheet/hardpad, spunbon, besi, alat, dan barang jadi) — bukan tempat membuang yang tidak jelas. Tidak ada bahan yang namanya bertentangan dengan kelompoknya (diperiksa otomatis; hanya ditandai bila ada, tidak pernah diubah).

### Bahan yang perlu keputusan manual (pratinjau)
| itemGroup | Bahan (aktif) | Alasan | Daftar bahan |
|---|---|---|---|
| <KOSONG> | 15 (0) | Bahan tidak punya itemGroup | ; … |
| SUPPORT KAIN | 9 (9) | Grup "SUPPORT KAIN" isinya campuran atau maknanya belum jelas — perlu keputusan manual | BADAN-RESLETING-YKK-NO-5 — BADAN RESLETING YKK NO.5; BENANG-HALUS-HITAM-40-2 — BENANG HALUS HITAM 40/2; BENANG-HALUS-PUTIH-40-2 — BENANG HALUS PUTIH 40/2; BENANG-KASAR-HITAM-20-2 — BENANG KASAR HITAM 20/2; BENANG-KASAR-PUTIH-20-2 — BENANG KASAR PUTIH 20/2; BENANG-KATUN-PUTIH — BENANG KATUN PUTIH; BENANG-NILON-PUTIH — BENANG NILON PUTIH; BENANG-OBRAS — BENANG OBRAS; KEPALA-SLETING — KEPALA SLETING |
| KANCING | 3 (3) | Grup "KANCING" isinya campuran atau maknanya belum jelas — perlu keputusan manual | CANGKANG-KANCING — CANGKANG KANCING; KAIN-OSCAR-COKLAT — KAIN OSCAR COKLAT; MATA-KANCING-0-32 — MATA KANCING 0.32 |
| SUPPORT | 4 (4) | Grup "SUPPORT" isinya campuran atau maknanya belum jelas — perlu keputusan manual | KAK-001 — KAKI 5 CM; RIN-001 — RING 4CM; SKR-001 — SKRUP TPG; SKRUP-GIPSUM-5 — SKRUP GIPSUM 5 |
| KAKI | 5 (5) | Grup "KAKI" isinya campuran atau maknanya belum jelas — perlu keputusan manual | KAKI-2CM — KAKI 2CM; KAKI-KAYU — KAKI KAYU; KAKI-KOTAK — KAKI KOTAK; KAKI-RETRO — KAKI RETRO; KAKI-RETRO-15-CM — KAKI RETRO 15 CM |
| OSCAR | 1 (1) | Grup "OSCAR" isinya campuran atau maknanya belum jelas — perlu keputusan manual | OSCAR-KW-10 — OSCAR KW 10 |
| STERILISASI | 2 (2) | Grup "STERILISASI" isinya campuran atau maknanya belum jelas — perlu keputusan manual | PERFUME-ANTI-BAKTERI — PERFUME ANTI BAKTERI; SHOE-PARFUME-REFRESH — SHOE PARFUME REFRESH |
| LACI | 2 (2) | Grup "LACI" isinya campuran atau maknanya belum jelas — perlu keputusan manual | REL-LACI — REL LACI; TARIKAN-LACI — TARIKAN LACI |
| RODA | 1 (1) | Grup "RODA" isinya campuran atau maknanya belum jelas — perlu keputusan manual | RODA — RODA |
| SAKURA | 1 (1) | Grup "SAKURA" isinya campuran atau maknanya belum jelas — perlu keputusan manual | SAKURA-HITAM-6CM — SAKURA HITAM 6CM |
| SUDUT | 1 (1) | Grup "SUDUT" isinya campuran atau maknanya belum jelas — perlu keputusan manual | SUDUT-GOLD — SUDUT GOLD |

Keputusan yang dibutuhkan dari petugas berwenang: untuk tiap grup di atas, tentukan kelompok per bahan (bukan per grup, karena isinya campuran). Selama belum diputuskan, bahan itu tampil di kartu **Belum dikelompokkan** (kartu berwarna peringatan + chip "N belum dikelompokkan" di layar awal).

### Rancangan perubahan data (BELUM dikerjakan; butuh persetujuan Owner)
Bila kelompok ingin disimpan permanen dan bisa dikoreksi petugas:
1. Kolom nullable `materials.operational_group varchar(16)` (kode: BUSA, KAIN, BENANG, PEGAS, KAYU, LEM_KIMIA, AKSESORI, LAINNYA) + `operational_group_set_by`/`_set_at`. Migrasi aditif, tanpa mengubah `itemGroup`.
2. Isi awal HANYA dari pemetaan di atas untuk grup yang jelas (skrip baca-saja menghasilkan pratinjau CSV; diterapkan setelah disetujui); sisanya tetap NULL sampai diputuskan manual lewat Ubah Item (izin tulis Gudang, tercatat sebagai aktivitas).
3. `kelompokDariItemGroup` menjadi cadangan bila kolom NULL; UI tidak berubah.
Tahap 3 ini tidak membutuhkan migrasi: kelompok turunan sudah cukup untuk navigasi.

### UI
- Layar awal = **navigasi**: kolom pencarian besar, satu baris ringkas ("45 bahan aktif · 19 ada stok"), chip perhatian (bersaldo minus, belum ada catatan, belum dikelompokkan), lalu kartu kelompok (jumlah total, diketahui, minus, belum diketahui, nonaktif). Ringkasan 373/358 bahan dan catatan sumber ada di "Rincian angka" (tertutup).
- Klik kartu → daftar kelompok itu. **Pencarian selalu mencari seluruh bahan** (kelompok/jenis tidak menyaring) dan menampilkan kelompok tiap hasil; kalimat cakupan menyatakannya. Hapus pencarian memulihkan kelompok yang dipilih.
- "← Semua kelompok" selalu tampil saat daftar terbuka. Kelompok kosong tampil "belum ada bahan"; nonaktif dihitung terpisah dan hanya ditampilkan bila diminta; "Tanpa kategori" tetap ada di saringan jenis.
- Jenis persediaan = pilihan kecil (bukan deretan tab). Seluruh keadaan di URL: `?kelompok=&jenis=&q=&keadaan=&nonaktif=1&semua=1` (bertahan saat refresh, bisa dibagikan). 390 px: kartu 2 kolom, tanpa luapan horizontal.

## 2. Penerimaan Barang sebagai pipeline + jendela fokus

- **Pipeline enam tahap** (server: `services/penerimaanStatus.js` `PIPELINE`): Draf → Terjadwal → Barang tiba → Pemeriksaan → Siap masuk stok → Sudah masuk stok; Dibatalkan/ditolak terpisah. Respons `tampilan` kini memuat `pipeline { tahap, indeks, pindah[] }` dan `berikutnya`.
- **Kontrol status** (gaya CRM) di header jendela: "Ubah status" menampilkan HANYA `tampilan.pipeline.pindah` (turunan dari aksi sah per status). Memilih perpindahan menjalankan aksi yang SAMA dengan tombolnya (isian, alasan, syarat server tetap berlaku) — tidak pernah menulis status langsung. Tidak ada lompatan: DRAF hanya bisa ke Terjadwal/Batal; Terjadwal ke Barang tiba (untuk PO lewat formulir kedatangan resmi)/Draf/Batal; Barang tiba → Pemeriksaan; … ; terposting **tanpa** perpindahan (hanya jalur Koreksi resmi). Server menolak lompatan (diuji: DRAF→ARRIVED/INSPECTION/READY/COMPLETED, TERJADWAL→INSPECTION/…, ARRIVED→READY, terposting→SCHEDULED).
- **Daftar**: strip pipeline (hitungan per tahap, tanda titik pada tahap yang menunggu tindakan Gudang), kolom **Tindakan berikutnya** (dari server), identitas GR/PO/supplier/jadwal/item. Saringan tahap + pencarian di URL (`?tahap=&q=`); kunci lama (jadwal, belum-masuk-stok, selesai, ditutup) tetap dikenali.
- **Jendela fokus berbasis rute** (`components/ui/fokus-overlay.jsx`): klik baris → `/warehouse/goods-receipt/:id` (rute sama dengan daftar, parameter opsional) — daftar tetap terpasang di belakang sehingga saringan, pencarian, dan posisi gulir kembali persis saat ditutup (Esc, Back, atau tombol Tutup). Tidak membuka tab workspace baru. Desktop: jendela besar (scale/fade), header tetap, isi bergulir, bilah aksi tetap terlihat; HP: layar penuh.
- **Satu lapisan**: `Modal` di dalam jendela fokus tidak membuka dialog kedua — isinya tampil sebagai panel di jendela yang sama (Catat barang tiba, Koreksi, dll.); isi dokumen di belakangnya tidak dibongkar. Esc pertama menutup panel, Esc kedua menutup jendela.
- **Detail PO (Barang Akan Datang)** memakai jendela yang sama (`/warehouse/barang-akan-datang/:id`). Dokumen/PO banyak item: ringkasan jumlah, kotak "cari item", header tabel menempel.
- Dua penerimaan Ocean untuk satu PO tetap dua dokumen (nomor GR sendiri, pipeline sendiri); Terjadwal tidak disajikan sebagai bukti barang tiba (tidak ada tanggal tiba; "Terjadwal — menunggu barang tiba"; GR lain di PO yang sama disebut, tidak digabung).

## 3. Sidebar enam kelompok
Beranda · Penerimaan · Stok · Produksi · Kontrol · Laporan (`components/GudangNavGrup.jsx`, logika `lib/gudangNav.js`). Menu rinci jadi anak yang dibuka; **satu kelompok terbuka sekaligus**; kelompok berisi halaman aktif selalu terbuka; kelompok terakhir yang dibuka diingat per perangkat. Penerimaan: Barang Akan Datang, Penerimaan Barang, Retur Supplier · Stok: Stok & Lokasi, Pengeluaran Material, Transfer Stok, Restok · Produksi: Antrean Produksi, Penerimaan Unit, Permintaan Bahan, Terima Barang Jadi · Kontrol: Stock Opname, Barang Rusak & Retur, Kasus Komplain, + konteks **Diproses Finance** (Pengajuan Biaya, Laporan Biaya, Opname Cutover Persediaan — izin dan rute tidak berubah) · Laporan: Riwayat Pergerakan, KPI Gudang.
Badge hanya untuk pekerjaan yang butuh tindakan (dari `GET /inventory/beranda`): Barang Akan Datang ← barang tiba yang perlu dicatat; Penerimaan Barang ← belum masuk stok; Pengeluaran Material ← permintaan bahan; Stock Opname ← selisih/koreksi menunggu. PO yang sekadar ditunggu BUKAN badge. Keyboard: ↑/↓ pindah fokus, → buka, ← tutup, Home/End, Enter/Spasi. Sidebar menyempit (72 px) tetap daftar ikon datar. Bookmark, tab tersimpan, dan permission tidak berubah.

## 4. Fleksibilitas status Penerimaan Barang (lanjutan)

Kebutuhan: dokumen yang salah diubah statusnya harus mudah dikembalikan atau dilanjutkan lagi, terutama GR yang baru dijadwalkan — selama belum memengaruhi stok atau jurnal.

### Matriks status final (dari server: `tampilan.pipeline.pindah` + `tertahan`)
| Dari | Maju | Mundur | Tutup |
|---|---|---|---|
| **Draf** | → Terjadwal | — | Batalkan |
| **Terjadwal** | → Barang tiba (PO: lewat *Catat barang tiba*; tanpa PO: tandai tiba) | → **Draf** | Batalkan |
| **Barang tiba** | → Pemeriksaan | → **Terjadwal** (hanya bila belum ada hasil pemeriksaan, faktur, retur, atau pengganti; bila ada, ditampilkan sebabnya) | Tolak barang |
| **Pemeriksaan** | → Siap masuk stok | → **Barang tiba** (hasil yang sudah diisi tidak dihapus) | Tolak barang |
| **Siap masuk stok** | → Sudah masuk stok (*Simpan ke Stok*) | → **Pemeriksaan** (selama belum Simpan ke Stok) | Tolak barang |
| **Sudah masuk stok** | — | **tidak ada** — hanya Koreksi Gudang (Koreksi Kedatangan / Koreksi penerimaan) | — |
| **Dibatalkan** | — | **Pulihkan ke status terakhir yang aman** (Draf atau Terjadwal sebelum dibatalkan) atau **Buat penerimaan baru** (tertaut) | — |
| **Ditolak** (barang pernah tiba) | — | hanya **Buat penerimaan baru** (tertaut) | — |

Aturan server (`routes/goodsReceipt.js`):
- Satu pintu mundur: `POST /:id/mundur { ke, alasan, revisi? }` (+ `/kembali-draft`, `/batalkan-tiba`, `/pulihkan` yang tetap ada). Hanya **satu langkah** matriks; selain itu 409 `PERPINDAHAN_TIDAK_SAH` (tidak ada lompatan). Dari "Sudah masuk stok" → 409 dengan arahan Koreksi Gudang.
- **Alasan wajib** (3–300 karakter) untuk setiap perpindahan mundur dan pemulihan; tercatat sebagai peristiwa aktivitas dengan pelaku, waktu, status asal → tujuan, dan alasan. Riwayat status (maju, mundur, catat tiba, batal, pulih, tolak, masuk stok) tampil di jendela detail ("Terjadwal → Draf", pelaku, alasan).
- **Tanpa saklar fitur dan tanpa approval kedua**; izin tulis Inventory yang sama dengan aksi lain (akun hanya-baca: 403 dan kontrol tidak ditampilkan).
- **Idempoten**: perpindahan ke status yang sudah berlaku → 200 `ulang:true` tanpa jejak ganda (klik ganda/retry aman); PATCH status yang sama juga 200 `ulang:true` (dulu 400).
- **Terkunci per dokumen** (`lockRowForUpdate`, status dibaca ulang dalam transaksi) dan **revisi** (`updatedAt`): layar basi → 409 `REVISI_BASI` "Dokumen ini sudah diubah pengguna lain…"; dua pengguna bersamaan → tepat satu menang, yang lain 409/hasil sama.
- **Data wajib tidak dilompati**: tiba untuk PO hanya lewat Catat Barang Tiba (tanggal, jumlah, penerima, catatan); masuk stok hanya lewat Simpan ke Stok (wajib ada jumlah baik; baik ≤ sisa PO). Perpindahan mundur tidak menghapus data pemeriksaan.
- Efek: **tidak ada pergerakan stok, jurnal, atau perubahan PO** pada perpindahan status mana pun sebelum posting (diuji dengan membandingkan stok/movement/jurnal/tagihan/jumlah PO dan jumlah baris sebelum–sesudah).

### Kasus Ocean (DB uji berbentuk data production; production tidak disentuh)
Tes `backend/tests/integration/gudangStatusMundur.integration.test.js` dan QA browser `pp/flows6.mjs`: PT OCEAN CENTRA FURNINDO, satu PO dua baris (Busa Ocean D18 120/160), dua GR untuk PO yang sama. GR uji Draf → Terjadwal → Draf → Terjadwal diulang tiga siklus (API) dan dua siklus (UI 1440 px dan 390 px). Terbukti: kedua GR tetap dua dokumen dengan nomor sendiri; GR lain tidak berubah (status, jadwal, updatedAt, jumlah baris); jumlah baris, PO, stok, movement, jurnal, tagihan tidak berubah; riwayat memuat tiap perpindahan beserta pelaku/alasan.

### Pembersihan disk VPS (19 Okt)
Audit: `/` 99 GB, 88 GB terpakai (94%): `backend/uploads` 36 GB (data produksi, tidak disentuh), containerd/Docker 28 + 4 GB, backups 5,8 GB, releases 3,6 GB. Dihapus HANYA yang terbukti bukan data: image tanpa tag (dangling) yang tidak dipakai kontainer mana pun, build cache > 24 jam (724 MB tersisa yang baru), dan cache npm (`~/.npm`, 701 MB; cache murni). Tidak dihapus: backup, tag rollback, release aktif/sebelumnya, DB rehearsal milik sesi lain, uploads. Hasil: bebas 6,3 → 7,7 GB.

## Pengujian
Backend integrasi `gudangUxTahap3` (3: kelompok dari itemGroup tanpa tebakan & tanpa tulis; pipeline + penolakan lompatan; dua GR satu PO), unit `kelompokBahan` (4); frontend `gudangUxTahap3.test.js` (8). QA browser `pp/flows5.mjs` 1440 px dan 390 px dengan DB terisolasi (`qa-server5.mjs`): Stok 18, Penerimaan 43, Barang Akan Datang 4, Sidebar 18 per viewport. Screenshot: `C:\\tmp\\km-gudang-iso\\qa\\t3\\{desktop,hp}\\` (sebelum: `qa\\masuk\\` dan layar Stok/Penerimaan live).

## Keterbatasan / pekerjaan terbuka
Daftar keputusan kelompok per bahan (29 bahan aktif): `docs/gudang-kelompok-bahan-keputusan.csv` — kolom "kelompok_pilihan" dikosongkan, menunggu keputusan Owner; BUKAN syarat rilis.
Kelompok masih turunan (belum disimpan); 29 bahan aktif menunggu keputusan manual; uji perangkat fisik belum; `GoodsReceiptDetailDrawer.jsx` masih ada (dipakai tautan lama, tak lagi dirutekan dari daftar); Retur Supplier dan halaman Gudang lain belum memakai jendela fokus (di luar cakupan).
