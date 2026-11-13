-- Penanda APLIKASI pemilik token push (12 November 2026). Tabel ini dipakai bersama SANO Finance dan SANSS Produksi.
-- Murni penambahan: baris lama otomatis 'finance' (satu-satunya aplikasi yang mendaftarkan token sebelum kolom ini ada).
-- Pengirim Finance hanya mengirim ke app='finance', pengirim Produksi hanya ke app='production' — Expo menolak satu
-- permintaan yang mencampur token dari dua proyek, dan notifikasi tidak boleh nyasar ke aplikasi lain.
ALTER TABLE "mobile_device_tokens" ADD COLUMN "app" TEXT NOT NULL DEFAULT 'finance';
CREATE INDEX "mobile_device_tokens_app_user_id_idx" ON "mobile_device_tokens"("app", "user_id");
