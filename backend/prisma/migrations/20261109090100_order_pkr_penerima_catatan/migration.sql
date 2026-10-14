-- Penerima/pemenuhan + catatan per divisi untuk order Penjualan Karyawan (Okt 2026) — ADITIF murni: 5 kolom NULL pada "Order".
-- Tanpa backfill, tanpa DEFAULT, tanpa UPDATE/DELETE, tanpa mengubah kolom/tabel lama. Order lama tetap NULL (tidak ditebak).

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "recipient_name" TEXT,
ADD COLUMN "recipient_phone" TEXT,
ADD COLUMN "delivery_landmark" TEXT,
ADD COLUMN "production_note" TEXT,
ADD COLUMN "delivery_note" TEXT;
