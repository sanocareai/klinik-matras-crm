-- Production Workshop + Warehouse V2 P1–P2: custody handoff unit (additive; tanpa DROP/UPDATE/DELETE).
-- Amended (belum applied di production): +cancelled_by_id/cancelled_at (rollback command), +constraint satu run aktif per unit.
-- CreateEnum
CREATE TYPE "UnitCustodyDirection" AS ENUM ('INBOUND', 'RETURN');

-- CreateEnum
CREATE TYPE "UnitCustodyHandoffStatus" AS ENUM ('OFFERED', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "unit_custody_handoffs_v2" (
    "id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "delivery_job_id" UUID NOT NULL,
    "direction" "UnitCustodyDirection" NOT NULL,
    "status" "UnitCustodyHandoffStatus" NOT NULL DEFAULT 'OFFERED',
    "location_id" UUID,
    "production_run_id" UUID,
    "offered_by_id" TEXT,
    "offered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_by_id" TEXT,
    "accepted_at" TIMESTAMP(3),
    "rejected_by_id" TEXT,
    "rejected_at" TIMESTAMP(3),
    "cancelled_by_id" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "reason" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "command_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "unit_custody_handoffs_v2_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "unit_custody_handoffs_v2_status_direction_offered_at_idx" ON "unit_custody_handoffs_v2"("status", "direction", "offered_at");

-- CreateIndex
CREATE INDEX "unit_custody_handoffs_v2_unit_id_direction_status_idx" ON "unit_custody_handoffs_v2"("unit_id", "direction", "status");

-- CreateIndex
CREATE UNIQUE INDEX "unit_custody_handoffs_v2_delivery_job_id_unit_id_key" ON "unit_custody_handoffs_v2"("delivery_job_id", "unit_id");

-- AddForeignKey
ALTER TABLE "unit_custody_handoffs_v2" ADD CONSTRAINT "unit_custody_handoffs_v2_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_custody_handoffs_v2" ADD CONSTRAINT "unit_custody_handoffs_v2_delivery_job_id_fkey" FOREIGN KEY ("delivery_job_id") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_custody_handoffs_v2" ADD CONSTRAINT "unit_custody_handoffs_v2_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "storage_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_custody_handoffs_v2" ADD CONSTRAINT "unit_custody_handoffs_v2_production_run_id_fkey" FOREIGN KEY ("production_run_id") REFERENCES "production_runs_v2"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Satu handoff AKTIF (OFFERED atau ACCEPTED) per unit dan direction. Handoff lama yang tergantikan berstatus SUPERSEDED
-- (dilakukan command owner dalam transaksi yang sama sebelum handoff baru dibuat).
CREATE UNIQUE INDEX "unit_custody_handoffs_v2_active_unit_direction_key"
  ON "unit_custody_handoffs_v2"("unit_id", "direction")
  WHERE "status" IN ('OFFERED', 'ACCEPTED');

-- Satu run produksi AKTIF (belum COMPLETED/CANCELLED) per unit — backstop database untuk lockRowForUpdate("units", ...)
-- di openProductionIntakeV2 (unitCustodyCommandService.js). Dua ACCEPTED dari jalur berbeda tidak boleh menghasilkan
-- dua run aktif untuk unit yang sama.
CREATE UNIQUE INDEX "production_runs_v2_active_unit_key"
  ON "production_runs_v2"("unit_id")
  WHERE "status" NOT IN ('COMPLETED', 'CANCELLED');
