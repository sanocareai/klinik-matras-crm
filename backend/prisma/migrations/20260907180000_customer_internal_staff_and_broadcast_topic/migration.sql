-- Customer.isInternalStaff + StaffBroadcast.topic (7 September 2026)
-- Lihat catatan panjang di schema.prisma model Customer/StaffBroadcast.
--
-- 1. Customer.isInternalStaff — bedakan nomor WA PRIBADI tim sendiri dari
--    pelanggan sungguhan, supaya GET /conversations bisa mengecualikan
--    mereka dari Inbox utama (tidak lagi menimbun chat pelanggan asli
--    tiap kali sales-reminder/sla-alert mengirim WA ke mereka).
-- 2. StaffBroadcast.topic — kunci idempotensi salesReminderDigestJob.js,
--    supaya satu topik tidak pernah terkirim 2x ke sales yang sama di
--    hari yang sama.
--
-- ADITIF MURNI: dua kolom baru (masing-masing dengan default aman untuk
-- baris lama) + dua index baru. Tidak ada kolom/data lama yang disentuh.
--
-- Rollback manual:
--   DROP INDEX "staff_broadcasts_kind_topic_created_at_idx";
--   ALTER TABLE "staff_broadcasts" DROP COLUMN "topic";
--   ALTER TABLE "Customer" DROP COLUMN "is_internal_staff";

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN "is_internal_staff" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "staff_broadcasts" ADD COLUMN "topic" TEXT;

-- CreateIndex
CREATE INDEX "staff_broadcasts_kind_topic_created_at_idx" ON "staff_broadcasts"("kind", "topic", "created_at");
