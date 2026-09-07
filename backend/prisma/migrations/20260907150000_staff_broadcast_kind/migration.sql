-- Staff Broadcast Kind (7 September 2026) — bedakan baris MANUAL (dibuat
-- admin lewat tab "Kirim Baru") dari AUTO_REMINDER (ditulis otomatis oleh
-- salesReminderDigestJob.js) supaya tab "Riwayat" bisa merekap keduanya.
-- Lihat catatan panjang di schema.prisma model StaffBroadcast.
--
-- ADITIF MURNI: satu enum baru + satu kolom baru (NOT NULL DEFAULT 'MANUAL'
-- — baris lama otomatis dianggap MANUAL, benar karena semuanya memang
-- dibuat manual sebelum kolom ini ada) + satu index baru. Tidak ada
-- kolom/data lama yang disentuh atau hilang.
--
-- Rollback manual:
--   DROP INDEX "staff_broadcasts_kind_created_at_idx";
--   ALTER TABLE "staff_broadcasts" DROP COLUMN "kind";
--   DROP TYPE "StaffBroadcastKind";

-- CreateEnum
CREATE TYPE "StaffBroadcastKind" AS ENUM ('MANUAL', 'AUTO_REMINDER');

-- AlterTable
ALTER TABLE "staff_broadcasts" ADD COLUMN "kind" "StaffBroadcastKind" NOT NULL DEFAULT 'MANUAL';

-- CreateIndex
CREATE INDEX "staff_broadcasts_kind_created_at_idx" ON "staff_broadcasts"("kind", "created_at");
