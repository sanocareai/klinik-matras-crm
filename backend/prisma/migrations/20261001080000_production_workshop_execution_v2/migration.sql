-- Production Workshop + Warehouse V2 P5: eksekusi workshop (start/jeda/lanjut/selesai tahap) + unit BARU/SEWA lahir di workshop.
-- Aditif: 1 enum baru, 1 kolom nullable pada production_runs_v2 (tabel V2, belum berisi run production), 1 partial unique index
-- pada production_operation_runs_v2. Tanpa DROP/UPDATE/DELETE; baris lama origin=NULL (perilaku tidak berubah).
-- CreateEnum
CREATE TYPE "ProductionRunOrigin" AS ENUM ('CUSTODY_PICKUP', 'WORKSHOP_BORN');

-- AlterTable
ALTER TABLE "production_runs_v2" ADD COLUMN     "origin" "ProductionRunOrigin";

-- Satu tahap AKTIF (ACTIVE atau PAUSED) per Production Run — Prisma tidak bisa mengekspresikan partial unique index.
CREATE UNIQUE INDEX "production_operation_runs_v2_active_run_key" ON "production_operation_runs_v2"("run_id") WHERE "status" IN ('ACTIVE', 'PAUSED');
