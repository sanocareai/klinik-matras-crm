-- Gambar promo untuk kampanye broadcast.
--
-- Promo Klinik Matras dibuat dalam bentuk desain (gambar), bukan hanya teks,
-- jadi kampanye perlu bisa mengirim beberapa gambar sebelum pesan teksnya.
-- Alasan urutan "gambar dulu, teks belakangan" ada di schema.prisma.
--
-- ADITIF MURNI: satu kolom array baru dengan default kosong. Kampanye lama
-- (kalau ada) tetap valid tanpa perubahan apa pun.

-- AlterTable
ALTER TABLE "broadcast_campaigns" ADD COLUMN "images" TEXT[] DEFAULT ARRAY[]::TEXT[];
