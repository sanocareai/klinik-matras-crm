-- Bukti pembayaran BANYAK foto (permintaan Owner 30 Sep 2026): kolom ADITIF, tanpa backfill, tanpa perubahan data lama.
-- proof_photo_url (foto pertama) tetap ada dan tetap diisi untuk kompatibilitas; proof_photo_urls memuat SEMUA foto (termasuk yang pertama).
ALTER TABLE "payments" ADD COLUMN "proof_photo_urls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
