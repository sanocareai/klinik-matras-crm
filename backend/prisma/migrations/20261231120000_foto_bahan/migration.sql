-- FOTO BAHAN (Okt 2026). ADITIF: dua kolom nullable di materials, tanpa default dan tanpa tulis ulang tabel. Tidak mengubah stok, ledger, harga, valuasi, jurnal, atau izin.
-- photo_file = nama berkas WebP di data/material-photos (NULL = belum ada foto). Tidak ada backfill: bahan yang sudah ada tetap tanpa foto sampai seseorang mengunggah.
-- KUNCI: ALTER TABLE ... ADD COLUMN membutuhkan kunci ACCESS EXCLUSIVE pada "materials" (singkat, karena tanpa default dan tanpa tulis ulang tabel, tetapi tetap harus menunggu transaksi lain yang
-- memegang tabel ini). Batas tunggu kunci dipasang supaya migrasi BERHENTI (gagal bersih, tanpa perubahan) bila database sibuk, bukan antre dan memblokir semua pembacaan "materials" di belakangnya.
-- Satu transaksi implisit untuk seluruh berkas: SET LOCAL hanya berlaku di transaksi ini dan hilang setelahnya.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE "materials" ADD COLUMN "photo_file" VARCHAR(80);
ALTER TABLE "materials" ADD COLUMN "photo_updated_at" TIMESTAMP(3);
