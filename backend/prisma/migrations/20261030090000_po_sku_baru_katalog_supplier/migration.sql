-- SKU baru dari Purchase Order + Katalog Supplier + konversi satuan — ADITIF: tabel baru, kolom NULLABLE, indeks, FK, CHECK. Tanpa UPDATE/DELETE/DROP/backfill:
-- material, stok, jurnal, PO, penerimaan, dan tagihan lama tidak berubah; kode lama tetap berjalan bila rilis dikembalikan.

-- AlterTable
ALTER TABLE "materials" ADD COLUMN     "kind" VARCHAR(24),
ADD COLUMN     "specification" TEXT,
ADD COLUMN     "storage_hint" TEXT,
ADD COLUMN     "created_via" VARCHAR(20),
ADD COLUMN     "created_by" TEXT;

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "unit_cost_exact" DECIMAL(24,8);

-- AlterTable
ALTER TABLE "fin_purchase_order_lines" ADD COLUMN     "purchase_unit" VARCHAR(20),
ADD COLUMN     "conversion_factor" DECIMAL(18,4),
ADD COLUMN     "supplier_material_id" UUID,
ADD COLUMN     "supplier_item_name" TEXT,
ADD COLUMN     "supplier_sku" TEXT;

-- CreateTable
CREATE TABLE "fin_material_sku_origins" (
    "id" UUID NOT NULL,
    "material_id" UUID NOT NULL,
    "created_by" TEXT,
    "first_purchase_order_id" UUID,
    "first_supplier_id" UUID,
    "normalized_name" TEXT NOT NULL,
    "initial_data" JSONB NOT NULL,
    "duplicate_candidates" JSONB,
    "duplicate_override_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_material_sku_origins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_supplier_materials" (
    "id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "material_id" UUID NOT NULL,
    "supplier_item_name" TEXT,
    "supplier_sku" TEXT,
    "purchase_unit" VARCHAR(20) NOT NULL,
    "conversion_factor" DECIMAL(18,4) NOT NULL DEFAULT 1,
    "moq" DECIMAL(14,3),
    "lead_time_days" INTEGER,
    "last_price" INTEGER,
    "last_price_at" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fin_supplier_materials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fin_material_sku_origins_material_id_key" ON "fin_material_sku_origins"("material_id");

-- CreateIndex
CREATE INDEX "fin_material_sku_origins_normalized_name_idx" ON "fin_material_sku_origins"("normalized_name");

-- CreateIndex
CREATE INDEX "fin_supplier_materials_material_id_idx" ON "fin_supplier_materials"("material_id");

-- CreateIndex
CREATE UNIQUE INDEX "fin_supplier_materials_supplier_id_material_id_key" ON "fin_supplier_materials"("supplier_id", "material_id");

-- AddForeignKey
ALTER TABLE "fin_purchase_order_lines" ADD CONSTRAINT "fin_purchase_order_lines_supplier_material_id_fkey" FOREIGN KEY ("supplier_material_id") REFERENCES "fin_supplier_materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_material_sku_origins" ADD CONSTRAINT "fin_material_sku_origins_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_material_sku_origins" ADD CONSTRAINT "fin_material_sku_origins_first_purchase_order_id_fkey" FOREIGN KEY ("first_purchase_order_id") REFERENCES "fin_purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_material_sku_origins" ADD CONSTRAINT "fin_material_sku_origins_first_supplier_id_fkey" FOREIGN KEY ("first_supplier_id") REFERENCES "fin_suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_supplier_materials" ADD CONSTRAINT "fin_supplier_materials_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "fin_suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_supplier_materials" ADD CONSTRAINT "fin_supplier_materials_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Constraints untuk kolom baru (NULL selalu lolos — baris lama tidak terpengaruh)
ALTER TABLE "materials" ADD CONSTRAINT "materials_kind_chk" CHECK ("kind" IS NULL OR "kind" IN ('BAHAN_PRODUKSI', 'PERLENGKAPAN_STOK'));
ALTER TABLE "fin_purchase_order_lines" ADD CONSTRAINT "fin_purchase_order_lines_konversi_chk" CHECK (("purchase_unit" IS NULL AND "conversion_factor" IS NULL) OR ("purchase_unit" IS NOT NULL AND "conversion_factor" IS NOT NULL AND "conversion_factor" > 0));
ALTER TABLE "fin_supplier_materials" ADD CONSTRAINT "fin_supplier_materials_faktor_chk" CHECK ("conversion_factor" > 0 AND ("moq" IS NULL OR "moq" > 0) AND ("lead_time_days" IS NULL OR "lead_time_days" >= 0) AND ("last_price" IS NULL OR "last_price" >= 0));
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_unit_cost_exact_chk" CHECK ("unit_cost_exact" IS NULL OR "unit_cost_exact" > 0);
