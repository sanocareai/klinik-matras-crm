
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

**Sesudah:** satu pola. Daftar/Beranda/Perlu Perhatian tetap terpasang; dokumen terbuka sebagai **jendela fokus** (URL berubah dan bisa dibagikan; Esc/Tutup/Back mengembalikan konteks termasuk filter dan posisi gulir; satu lapisan — formulir/konfirmasi menjadi panel di jendela yang sama; bilah aksi tetap di dasar jendela).

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

DB terisolasi `km_qa_t4_test` (bukan production), 100+ dokumen: 100 penerimaan (60 dijadwalkan: 20 tanpa tanggal, 20 lewat jadwal, 10 hari ini, 10 depan; 15 tiba; 10 pemeriksaan; 5 siap stok; 10 penerimaan kosong lama yang **tidak** dihitung), 31 permintaan bahan, 15 transfer (3 selesai: 2 berselisih), 4 Stock Count, koreksi/penyesuaian/restok/rusak/retur/PO.

| Pengujian | Desktop 1440 | HP 390 |
|---|---|---|
| `flows7.mjs` (browser nyata) | __DESKTOP__ | __HP__ |
| Tes integrasi backend `gudangPusatKerja` (100+ dokumen, terlambat/tertahan nyata, izin, paginasi, Pusat Masalah, pencarian + tindakan cepat, tanpa jalur tulis) | 6/6 | — |
| Tes frontend baru `gudangUxTahap4.test.js` | 11/11 | — |
| Tes frontend lama yang mengunci struktur lama (diperbarui sesuai pola baru): UxTahap1/2/3, koreksiGudang, gudangPintuMasuk, returSupplierUI, poTerintegrasiUI, legacyProductionRoutes | lulus | — |
| Suite frontend penuh | 1176 tes, 9 gagal = **9 gagal lama yang sama dengan baseline** (Unit 360 ×3, toIsoOrNull, gulir otomatis, shell onBack, view sintetis, Layar angka dari server, aktivasi Jadwalkan) | — |
| Regresi integrasi backend (Gudang, Koreksi, Retur Supplier, Opname Cutover, Produksi MI/QC/antrean, Finance) | __REGRESI__ | — |

Yang dicakup `flows7.mjs`: struktur Beranda + hitungan = server; kartu memuat dokumen/status/alasan/umur/pemilik; definisi antrean; "terlambat" hanya bertanggal; konflik revisi "tidak dihitung"; jendela fokus dari kartu (URL, satu lapisan, Beranda tetap, Esc/Tutup/Back/Forward, gulir tetap); deep link semua 12 jenis; "Tampilkan lagi" 60/60 tanpa duplikat; tindakan cepat hanya membuka/menyorot (stok/movement/jurnal/status tidak berubah); pencarian lintas dokumen; Perlu Perhatian (cakupan, tanpa blocker global); 8 pola daftar+jendela; Back kembali ke daftar dengan filter utuh; akun baca-saja; perbedaan izin (Owner vs Gudang untuk koreksi); loading/galat/kosong/dokumen tidak ditemukan; dokumen sudah diproses pengguna lain (idempoten, keadaan terbaru tampil); klik ganda = satu perpindahan; bilah aksi tetap; keyboard angka; target sentuh HP; performa 100+ dokumen. Tangkapan layar: `C:\tmp\km-gudang-iso\qa\t4\{desktop,hp}\`.

**Batas pengujian yang jujur:** diuji di Chrome headless terhadap DB terisolasi; belum di perangkat fisik (Android/iOS) dan belum dengan akun production nyata (tidak ada transaksi QA di production — instruksi). Antrean Produksi V2 tidak terisi di QA (pembaca V2 OFF, sama seperti production).

## 7. Keputusan

- **Kandidat:** `__SHA__` (branch `feat/gudang-ux-tahap4`, dasar live `58cbc284`; belum merge ke `main`, `main` masih `694f2184`).
- **Keputusan: GO untuk rilis frontend+backend (code-only) setelah persetujuan Owner**, dengan syarat: (1) cek ulang live saat rilis (sesi lain bisa menggeser), (2) skrip rilis bergerbang dibangkitkan dari generator Tahap 3 terhadap baseline live saat itu, (3) disk VPS 4,3 GB (96%) di bawah gerbang 5 GB skrip rilis — perlu pembersihan aman atau pengecualian eksplisit. **NO-GO** bila baseline live bergeser ke berkas Gudang atau ada migrasi baru.
- **Risiko residual:** Retur Supplier masih Modal; Antrean Produksi V2 belum terverifikasi dengan data nyata (reader OFF); belum ada uji perangkat fisik; hitungan Beranda membaca tabel dokumen aktif secara penuh (aman untuk volume sekarang; jika dokumen aktif melebihi ±2000 per tabel perlu indeks/ringkasan terhitung).

## 8. Komponen lama yang aman dihapus kemudian (bukan di Tahap 4)

- `frontend/src/pages/Gudang.jsx` (563 baris, command center lama) — tidak diimpor siapa pun; dirujuk komentar di `Layout.jsx` dan `inventoryReal.js`, serta dibaca teksnya oleh `penyesuaianStok.test.js`/`gudangPintuMasuk.test.js` (perlu disesuaikan sebelum menghapus).
- Mode akordeon `KoreksiDokumenTab` (bila `onBuka` tidak diberikan) — kini hanya jalur cadangan.
- Tautan `?buka=<id>` lama di Pengeluaran Material/Transfer/Penerimaan — masih dipertahankan untuk kompatibilitas tautan notifikasi; hapus bila tautan lama sudah tidak beredar.
- **Jangan hapus:** `services/gudangBeranda.js` dan `GET /inventory/beranda` (badge sidebar), `ActiveComplaintsWidget`.
