-- Production Core Slice 1 (6 September 2026) — prioritas produksi + tanggal
-- target, murni ADITIF. Tidak ada data lama yang diubah atau dihapus.
--
-- priority default 'NORMAL' untuk SELURUH unit lama — jujur "belum pernah
-- ditriase", bukan tebakan mendesak/tidak. production_due_at dan
-- customer_promise_date NULL untuk seluruh baris lama — tidak pernah ada
-- tanggal janji yang tercatat terstruktur untuk order historis, mengarang
-- tanggal akan lebih menyesatkan daripada mengosongkannya.
--
-- Rollback manual:
--   ALTER TABLE "Order" DROP COLUMN "customer_promise_date";
--   ALTER TABLE "units" DROP COLUMN "priority", DROP COLUMN "production_due_at";
--   DROP TYPE "ProductionPriority";

-- CreateEnum
CREATE TYPE "ProductionPriority" AS ENUM ('NORMAL', 'HIGH', 'URGENT', 'CRITICAL');

-- AlterTable
ALTER TABLE "units"
  ADD COLUMN "priority" "ProductionPriority" NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN "production_due_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "customer_promise_date" DATE;
