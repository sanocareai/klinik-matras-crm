-- Batas maksimal diskon per promo/voucher (8 Okt 2026): potongan harga maksimum dalam Rupiah.
-- NULL = tanpa batas (perilaku lama, semua promo yang sudah ada tidak berubah). Murni aditif.
ALTER TABLE "promos" ADD COLUMN "max_discount_amount" INTEGER;
