-- Production Core Slice 3 (6 September 2026) — jeda eksekusi tahap
-- (PAUSE/RESUME). Lihat catatan panjang di schema.prisma enum PauseReason
-- untuk kenapa ini TERPISAH dari BlockReason.
--
-- ADITIF MURNI: satu enum baru + satu kolom nullable baru di unit_stage_logs
-- (tabel sudah ada sejak Phase 0), tidak ada kolom/data lama yang disentuh.
-- Tidak perlu index baru — query timing (unit_id + stage_id, order by
-- created_at) sudah ditopang index [stage_id, created_at] & [unit_id,
-- created_at] yang sudah ada; volume per (unit, stage) selalu kecil (jeda
-- 0-beberapa kali per attempt), bukan pola yang butuh index majemuk baru.
--
-- Rollback manual:
--   ALTER TABLE "unit_stage_logs" DROP COLUMN "pause_reason";
--   DROP TYPE "PauseReason";

-- CreateEnum
CREATE TYPE "PauseReason" AS ENUM ('BREAK', 'PROCESS_DELAY', 'OTHER');

-- AlterTable
ALTER TABLE "unit_stage_logs" ADD COLUMN "pause_reason" "PauseReason";
