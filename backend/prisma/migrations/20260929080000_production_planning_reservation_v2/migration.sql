-- Production Workshop + Warehouse V2 P3: Planning H-1, assignment, Planned BOM, reservasi bahan (aditif; tanpa DROP/UPDATE/DELETE).
-- 3 tabel baru (production_run_plans_v2, planned_bom_lines_v2, material_reservations_v2) + 2 partial unique index manual
-- (Prisma tidak bisa mengekspresikan WHERE di @@unique). Tidak ada ALTER pada tabel lama.
-- CreateEnum
CREATE TYPE "ProductionPlanStatus" AS ENUM ('DRAFT', 'PLANNED', 'MATERIAL_RESERVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PlannedBOMLineStatus" AS ENUM ('ACTIVE', 'SUPERSEDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MaterialReservationStatus" AS ENUM ('ACTIVE', 'RELEASED', 'CONSUMED', 'CANCELLED');

-- CreateTable
CREATE TABLE "production_run_plans_v2" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "status" "ProductionPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "work_center_id" UUID,
    "operator_id" UUID,
    "target_start_at" TIMESTAMP(3),
    "target_complete_at" TIMESTAMP(3),
    "planned_by_id" TEXT,
    "planned_at" TIMESTAMP(3),
    "material_reserved_by_id" TEXT,
    "material_reserved_at" TIMESTAMP(3),
    "cancelled_by_id" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "command_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_run_plans_v2_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "planned_bom_lines_v2" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "material_id" UUID NOT NULL,
    "qty" DECIMAL(12,4) NOT NULL,
    "unit" "MaterialUnit" NOT NULL,
    "status" "PlannedBOMLineStatus" NOT NULL DEFAULT 'ACTIVE',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "superseded_by_id" TEXT,
    "superseded_at" TIMESTAMP(3),

    CONSTRAINT "planned_bom_lines_v2_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_reservations_v2" (
    "id" UUID NOT NULL,
    "bom_line_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "material_id" UUID NOT NULL,
    "qty" DECIMAL(12,4) NOT NULL,
    "status" "MaterialReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "reserved_by_id" TEXT,
    "reserved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_by_id" TEXT,
    "released_at" TIMESTAMP(3),
    "release_reason" TEXT,
    "command_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "material_reservations_v2_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "production_run_plans_v2_run_id_key" ON "production_run_plans_v2"("run_id");

-- CreateIndex
CREATE INDEX "production_run_plans_v2_status_updated_at_idx" ON "production_run_plans_v2"("status", "updated_at");

-- CreateIndex
CREATE INDEX "planned_bom_lines_v2_plan_id_status_idx" ON "planned_bom_lines_v2"("plan_id", "status");

-- CreateIndex
CREATE INDEX "planned_bom_lines_v2_material_id_idx" ON "planned_bom_lines_v2"("material_id");

-- CreateIndex
CREATE INDEX "material_reservations_v2_plan_id_status_idx" ON "material_reservations_v2"("plan_id", "status");

-- CreateIndex
CREATE INDEX "material_reservations_v2_material_id_status_idx" ON "material_reservations_v2"("material_id", "status");

-- AddForeignKey
ALTER TABLE "production_run_plans_v2" ADD CONSTRAINT "production_run_plans_v2_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "production_runs_v2"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_run_plans_v2" ADD CONSTRAINT "production_run_plans_v2_work_center_id_fkey" FOREIGN KEY ("work_center_id") REFERENCES "work_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_run_plans_v2" ADD CONSTRAINT "production_run_plans_v2_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "production_operators"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planned_bom_lines_v2" ADD CONSTRAINT "planned_bom_lines_v2_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "production_run_plans_v2"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planned_bom_lines_v2" ADD CONSTRAINT "planned_bom_lines_v2_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_reservations_v2" ADD CONSTRAINT "material_reservations_v2_bom_line_id_fkey" FOREIGN KEY ("bom_line_id") REFERENCES "planned_bom_lines_v2"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_reservations_v2" ADD CONSTRAINT "material_reservations_v2_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "production_run_plans_v2"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_reservations_v2" ADD CONSTRAINT "material_reservations_v2_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Satu Planned BOM line AKTIF per (plan, material) — Prisma tidak bisa mengekspresikan partial unique index.
CREATE UNIQUE INDEX "planned_bom_lines_v2_active_material_key" ON "planned_bom_lines_v2"("plan_id", "material_id") WHERE "status" = 'ACTIVE';

-- Satu reservasi AKTIF per BOM line (sumber) — histori (RELEASED/CONSUMED/CANCELLED) boleh banyak.
CREATE UNIQUE INDEX "material_reservations_v2_active_bom_line_key" ON "material_reservations_v2"("bom_line_id") WHERE "status" = 'ACTIVE';
