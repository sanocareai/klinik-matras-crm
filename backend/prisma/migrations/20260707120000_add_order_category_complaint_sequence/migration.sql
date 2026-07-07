-- Tambah enum OrderCategory
CREATE TYPE "OrderCategory" AS ENUM ('LAYANAN', 'SEWA', 'BARU');

-- Tambah kolom baru ke Order
ALTER TABLE "Order"
  ADD COLUMN "category"        "OrderCategory" NOT NULL DEFAULT 'LAYANAN',
  ADD COLUMN "hasComplaint"    BOOLEAN         NOT NULL DEFAULT false,
  ADD COLUMN "complaintDate"   TIMESTAMP(3),
  ADD COLUMN "complaintDetail" TEXT;

-- Tambah unique constraint ke orderNumber
-- CATATAN: kalau ada data historis dengan duplicate non-null orderNumber, jalankan dulu:
--   SELECT "orderNumber", COUNT(*) FROM "Order" WHERE "orderNumber" IS NOT NULL GROUP BY "orderNumber" HAVING COUNT(*) > 1;
-- Kalau ada duplikat, hapus/perbaiki dulu sebelum migrate.
ALTER TABLE "Order" ADD CONSTRAINT "Order_orderNumber_key" UNIQUE ("orderNumber");

-- Buat tabel OrderSequence untuk counter nomor order otomatis
CREATE TABLE "OrderSequence" (
  "id"      TEXT         NOT NULL,
  "prefix"  TEXT         NOT NULL,
  "year"    INTEGER      NOT NULL,
  "month"   INTEGER      NOT NULL,
  "lastSeq" INTEGER      NOT NULL DEFAULT 0,
  CONSTRAINT "OrderSequence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrderSequence_prefix_year_month_key" ON "OrderSequence"("prefix", "year", "month");
