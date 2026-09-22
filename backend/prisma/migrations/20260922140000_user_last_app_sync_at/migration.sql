-- Bug Agung (22 September 2026): tidak ada sinyal server-side kapan app driver terakhir benar-benar sinkron.
-- Aditif murni — kolom nullable, tidak ada default yang menimpa baris lama, tidak menyentuh tabel lain.
ALTER TABLE "User" ADD COLUMN "last_app_sync_at" TIMESTAMP(3);
