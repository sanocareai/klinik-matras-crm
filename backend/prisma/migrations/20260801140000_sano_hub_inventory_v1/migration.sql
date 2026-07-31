-- Sano Hub Phase 3 — Inventory v1 (PRD §8). Katalog material + ledger
-- stock_movements APPEND-ONLY. Stok dihitung on-the-fly (SUM per material),
-- bukan materialized view — lihat catatan di schema.prisma.

-- CreateEnum
CREATE TYPE "MaterialUnit" AS ENUM ('PCS', 'METER', 'M3', 'SHEET', 'SPOOL', 'KG');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('RECEIPT', 'ISSUE', 'RETURN', 'WASTE', 'ADJUSTMENT');

-- CreateTable
CREATE TABLE "materials" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" "MaterialUnit" NOT NULL,
    "service_line" "ServiceLine",
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "material_id" UUID NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "qty" DECIMAL(12,4) NOT NULL,
    "location" TEXT NOT NULL DEFAULT 'GUDANG_UTAMA',
    "unit_id" UUID,
    "unit_cost" INTEGER,
    "supplier" TEXT,
    "batch_number" TEXT,
    "reason" TEXT,
    "note" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "materials_code_key" ON "materials"("code");

-- CreateIndex
CREATE INDEX "materials_active_idx" ON "materials"("active");

-- CreateIndex
CREATE INDEX "stock_movements_material_id_created_at_idx" ON "stock_movements"("material_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_movements_unit_id_idx" ON "stock_movements"("unit_id");

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
