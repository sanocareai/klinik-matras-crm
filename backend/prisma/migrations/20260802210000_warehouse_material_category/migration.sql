-- Warehouse Tahap 2 — kategori item gudang.
--
-- KENAPA. Katalog v1 cuma membedakan material lewat `service_line`
-- (SERVICE/UPGRADE). Itu cukup selama isinya HANYA bahan baku bengkel.
-- Begitu gudang juga menyimpan barang setengah jadi (WIP) dan produk jadi,
-- "lini layanan" tidak lagi bisa menjawab pertanyaan "ini barang jenis apa" —
-- dan tanpa jawabannya, tab kategori serta laporan nilai inventory per
-- kategori TIDAK MUNGKIN dibangun tanpa mengarang.
--
-- AMAN DILAKUKAN SEKARANG, dan ini jendela termurahnya: tabel `materials`
-- masih KOSONG (0 baris, diverifikasi langsung di production sebelum migrasi
-- ini ditulis). Tidak ada satu pun item historis yang kategorinya harus
-- ditebak. Menunda sampai katalog terisi ratusan item berarti menebak
-- kategori untuk data lama — dan tebakan itu masuk ke laporan.
--
-- ADITIF MURNI: 1 enum + 1 kolom NULLABLE. Tidak ada kolom lama yang berubah
-- arti, tidak ada backfill, tidak ada data yang disentuh. `service_line`
-- TETAP berfungsi persis seperti sebelumnya (D-004: dua lini tidak boleh
-- campur material) — kategori menjawab pertanyaan yang BERBEDA, bukan
-- pengganti.

CREATE TYPE "MaterialCategory" AS ENUM ('RAW_MATERIAL', 'WIP', 'FINISHED_GOODS', 'CONSUMABLE');

-- NULLABLE, tanpa default: item tanpa kategori tampil apa adanya sebagai
-- "Tanpa kategori" di UI, BUKAN disamarkan jadi RAW_MATERIAL. Menebak
-- diam-diam lebih berbahaya daripada mengakui datanya belum diisi.
ALTER TABLE "materials" ADD COLUMN "category" "MaterialCategory";
