-- Warehouse Tahap 5 — Stock Count / Stock Opname.
--
-- v1 SUDAH punya penyesuaian satu langkah (POST /inventory/movements/
-- adjustment) — TIDAK diubah, masih jalan untuk "hitung satu item, sesuaikan
-- sekarang". StockCount adalah dokumen di depannya untuk sesi hitung
-- terjadwal, mencakup banyak item sekaligus, dengan BLIND COUNT opsional.
--
-- systemQty DISNAPSHOT SEKALI saat Start Count — bukan dihitung ulang tiap
-- saat. Stok TIDAK BERUBAH sampai Complete Count menulis baris ADJUSTMENT,
-- satu per baris yang punya selisih — disiplin PRD §8.1 tetap utuh.
--
-- AMAN SEKARANG: stock_movements masih KOSONG di production.

CREATE TYPE "CountType" AS ENUM ('CYCLE_COUNT', 'FULL_STOCK_OPNAME');

CREATE TYPE "CountMethod" AS ENUM (
  'BY_ITEM', 'BY_CATEGORY', 'BY_LOCATION', 'BY_BATCH', 'RANDOM_SAMPLING', 'FULL_WAREHOUSE'
);

CREATE TYPE "CountStatus" AS ENUM (
  'SCHEDULED', 'IN_PROGRESS', 'WAITING_REVIEW', 'COMPLETED', 'CANCELLED'
);

CREATE TABLE "stock_counts" (
    "id"             UUID NOT NULL,
    "count_number"   TEXT NOT NULL,
    "count_type"     "CountType" NOT NULL,
    "count_method"   "CountMethod" NOT NULL,
    "scheduled_date" DATE,
    "blind_count"    BOOLEAN NOT NULL DEFAULT true,
    "notes"          TEXT,
    "status"         "CountStatus" NOT NULL DEFAULT 'SCHEDULED',
    "assigned_to"    TEXT,
    "started_at"     TIMESTAMP(3),
    "submitted_at"   TIMESTAMP(3),
    "reviewed_by"    TEXT,
    "completed_at"   TIMESTAMP(3),
    "created_by"     TEXT,
    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_counts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "stock_counts_count_number_key" ON "stock_counts"("count_number");
CREATE INDEX "stock_counts_status_idx" ON "stock_counts"("status");
CREATE INDEX "stock_counts_scheduled_date_idx" ON "stock_counts"("scheduled_date");

ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_assigned_to_fkey"
    FOREIGN KEY ("assigned_to") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_reviewed_by_fkey"
    FOREIGN KEY ("reviewed_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "stock_count_lines" (
    "id"             UUID NOT NULL,
    "stock_count_id" UUID NOT NULL,
    "material_id"    UUID NOT NULL,
    "system_qty"     DOUBLE PRECISION,
    "counted_qty"    DOUBLE PRECISION,
    "reason"         TEXT,
    "notes"          TEXT,

    CONSTRAINT "stock_count_lines_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "stock_count_lines_stock_count_id_idx" ON "stock_count_lines"("stock_count_id");
CREATE INDEX "stock_count_lines_material_id_idx" ON "stock_count_lines"("material_id");
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_stock_count_id_fkey"
    FOREIGN KEY ("stock_count_id") REFERENCES "stock_counts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_material_id_fkey"
    FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_movements" ADD COLUMN "stock_count_id" UUID;
CREATE INDEX "stock_movements_stock_count_id_idx" ON "stock_movements"("stock_count_id");
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_stock_count_id_fkey"
    FOREIGN KEY ("stock_count_id") REFERENCES "stock_counts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
