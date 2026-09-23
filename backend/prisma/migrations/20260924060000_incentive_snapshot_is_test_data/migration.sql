-- Penanda data uji pada Snapshot Insentif (24 September 2026) — lihat
-- komentar panjang di schema.prisma model IncentiveSnapshot, field
-- isTestData. Dibutuhkan khusus untuk menandai Snapshot APPROVED hasil
-- smoke-test production yang tidak bisa "dibatalkan" lewat jalur REJECT
-- (cuma berlaku dari DRAFT/REVIEWED) maupun VOID (operasi payout, bukan
-- snapshot). Default false untuk semua Snapshot lama & baru.
ALTER TABLE "incentive_snapshots" ADD COLUMN     "is_test_data" BOOLEAN NOT NULL DEFAULT false;
