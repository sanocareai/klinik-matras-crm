-- Poster (cover) video + ukuran TAMPIL video.
--
-- ADITIF & NULLABLE: tidak ada backfill di dalam migrasi ini, tidak ada
-- kolom lama yang diubah/dihapus, jadi aman dijalankan pada tabel Message
-- yang sudah berisi puluhan ribu baris di produksi. Poster untuk video lama
-- dibuat terpisah lewat scripts/backfill-video-poster.js (ffmpeg per file,
-- terlalu lambat untuk dijalankan di dalam transaksi migrasi).
ALTER TABLE "Message" ADD COLUMN "thumbUrl" TEXT;
ALTER TABLE "Message" ADD COLUMN "mediaWidth" INTEGER;
ALTER TABLE "Message" ADD COLUMN "mediaHeight" INTEGER;
