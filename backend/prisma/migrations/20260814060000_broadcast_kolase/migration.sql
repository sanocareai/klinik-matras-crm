-- Pilihan gabung beberapa gambar promo jadi satu gambar kisi ("kolase").
--
-- Album WhatsApp asli tidak bisa dipakai: WAHA di server ini bertier CORE
-- dan tidak menyediakan endpoint album (diverifikasi 14 Agt 2026 —
-- /api/sendAlbum, /api/sendImages, /api/sendMediaGroup semuanya 404).
-- Menyusun kisinya sendiri jadi satu berkas adalah satu-satunya cara
-- memunculkan tampilan itu tanpa menaikkan tier WAHA.
--
-- Default false: untuk desain promo yang penuh tulisan, menggabung justru
-- mengecilkan teks dan menyulitkan dibaca di layar HP. Jadi ini pilihan
-- sadar per kampanye, bukan perilaku baku.
--
-- ADITIF MURNI: satu kolom boolean baru dengan default. Kampanye yang sudah
-- ada tetap berperilaku persis seperti sebelumnya.

-- AlterTable
ALTER TABLE "broadcast_campaigns" ADD COLUMN "kolase" BOOLEAN NOT NULL DEFAULT false;
