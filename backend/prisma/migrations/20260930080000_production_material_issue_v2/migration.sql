-- Production Workshop + Warehouse V2 P4: permintaan pengambilan bahan (Material Issue) dari Planned BOM/reservasi
-- P3, PICKED atomik (stock movement + HPP + reservasi CONSUMED). Aditif: hanya ADD COLUMN nullable (kecuali
-- revision default 1) pada tabel v1 yang SUDAH punya baris di production (material_issues/material_issue_lines)
-- + kolom baru di material_reservations_v2 (P3, masih kosong). TIDAK ADA DROP/UPDATE/DELETE data lama; semua
-- baris v1 existing otomatis mendapat production_plan_id/reservation_id/consumed_*=NULL (perilaku V1 tidak berubah).
-- AlterTable
ALTER TABLE "material_issues" ADD COLUMN     "cancel_reason" TEXT,
ADD COLUMN     "cancelled_at" TIMESTAMP(3),
ADD COLUMN     "cancelled_by_id" TEXT,
ADD COLUMN     "command_id" UUID,
ADD COLUMN     "production_plan_id" UUID,
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "material_issue_lines" ADD COLUMN     "reservation_id" UUID;

-- AlterTable
ALTER TABLE "material_reservations_v2" ADD COLUMN     "consumed_at" TIMESTAMP(3),
ADD COLUMN     "consumed_by_id" TEXT;

-- CreateIndex
CREATE INDEX "material_issues_production_plan_id_idx" ON "material_issues"("production_plan_id");

-- CreateIndex
CREATE UNIQUE INDEX "material_issue_lines_reservation_id_key" ON "material_issue_lines"("reservation_id");

-- AddForeignKey
ALTER TABLE "material_issues" ADD CONSTRAINT "material_issues_production_plan_id_fkey" FOREIGN KEY ("production_plan_id") REFERENCES "production_run_plans_v2"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_issue_lines" ADD CONSTRAINT "material_issue_lines_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "material_reservations_v2"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Satu Material Issue AKTIF (belum ISSUED/CANCELLED) per Production Plan — Prisma tidak bisa mengekspresikan
-- partial unique index. Baris v1 (production_plan_id NULL) tidak terpengaruh.
CREATE UNIQUE INDEX "material_issues_active_plan_key" ON "material_issues"("production_plan_id") WHERE "production_plan_id" IS NOT NULL AND "status" NOT IN ('ISSUED', 'CANCELLED');
