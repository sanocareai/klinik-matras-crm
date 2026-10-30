-- FOTO BAHAN (Okt 2026). ADITIF: dua kolom nullable di materials, tanpa default dan tanpa tulis ulang tabel. Tidak mengubah stok, ledger, harga, valuasi, jurnal, atau izin.
-- photo_file = nama berkas WebP di data/material-photos (NULL = belum ada foto). Tidak ada backfill: bahan yang sudah ada tetap tanpa foto sampai seseorang mengunggah.
ALTER TABLE "materials" ADD COLUMN "photo_file" VARCHAR(80);
ALTER TABLE "materials" ADD COLUMN "photo_updated_at" TIMESTAMP(3);
