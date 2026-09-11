-- AlterTable
-- Integrasi Material Issue <-> Production Unit (Warehouse<->Production
-- end-to-end, 12 Sept 2026). Nullable, additive — request lama (sourceType
-- selain PRODUCTION_WORK_ORDER) tetap sah tanpa unit_id.
ALTER TABLE "material_issues" ADD COLUMN "unit_id" UUID;

-- CreateIndex
CREATE INDEX "material_issues_unit_id_idx" ON "material_issues"("unit_id");

-- AddForeignKey
ALTER TABLE "material_issues" ADD CONSTRAINT "material_issues_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
