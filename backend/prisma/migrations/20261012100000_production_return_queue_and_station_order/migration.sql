-- Additif: urutan manual unit per meja + antrean retur sisa bahan produksi (Gudang). Tanpa DROP/UPDATE/DELETE.
-- CreateEnum
CREATE TYPE "ProductionMaterialReturnStatus" AS ENUM ('PENDING', 'RECEIVED');

-- AlterTable
ALTER TABLE "production_run_plans_v2" ADD COLUMN "station_sequence" INTEGER;

-- CreateTable
CREATE TABLE "production_material_returns_v2" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "unit_id" TEXT NOT NULL,
    "material_id" UUID NOT NULL,
    "qty" DECIMAL(12,4) NOT NULL,
    "status" "ProductionMaterialReturnStatus" NOT NULL DEFAULT 'PENDING',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "received_by_id" TEXT,
    "received_at" TIMESTAMP(3),
    "received_qty" DECIMAL(12,4),
    "note" TEXT,
    "command_id" UUID,

    CONSTRAINT "production_material_returns_v2_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "production_material_returns_v2_run_id_material_id_key" ON "production_material_returns_v2"("run_id", "material_id");

-- CreateIndex
CREATE INDEX "production_material_returns_v2_status_requested_at_idx" ON "production_material_returns_v2"("status", "requested_at");

-- AddForeignKey
ALTER TABLE "production_material_returns_v2" ADD CONSTRAINT "production_material_returns_v2_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "production_runs_v2"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_material_returns_v2" ADD CONSTRAINT "production_material_returns_v2_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
