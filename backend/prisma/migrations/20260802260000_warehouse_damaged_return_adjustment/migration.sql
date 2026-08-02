-- Warehouse Tahap 6 — Damaged Stock, Returns, Stock Adjustment (review-gated).
--
-- KETIGANYA MEMAKAI TIPE MOVEMENT YANG SUDAH ADA (WASTE, RETURN, ADJUSTMENT)
-- — TIDAK ADA nilai StockMovementType baru. Endpoint satu-langkah v1
-- (/movements/waste, /return, /adjustment) TIDAK diubah. Tiga dokumen di
-- sini membungkus KEPUTUSAN yang perlu ditinjau dulu sebelum ledger
-- benar-benar ditulis.
--
-- KONSEKUENSI YANG DIAKUI: sistem ini tidak punya saldo per lokasi/status,
-- jadi melaporkan barang rusak TIDAK otomatis mengurangi saldo tersedia —
-- baru berubah saat resolusi benar-benar mengeluarkannya dari sistem.
--
-- AMAN SEKARANG: stock_movements masih KOSONG di production.

CREATE TYPE "DamageCategory" AS ENUM (
  'TORN', 'WET', 'CONTAMINATED', 'DEFORMED', 'PACKAGING_DAMAGE',
  'EXPIRED', 'PRODUCTION_DEFECT', 'DELIVERY_DAMAGE', 'OTHER'
);
CREATE TYPE "DamagedStockStatus" AS ENUM ('REPORTED', 'UNDER_INSPECTION', 'RESOLVED');
CREATE TYPE "DamagedResolution" AS ENUM ('RETURN_TO_SUPPLIER', 'REWORK', 'DISPOSE', 'RESTORE_TO_AVAILABLE');

CREATE TABLE "damaged_stock_records" (
    "id"              UUID NOT NULL,
    "record_number"   TEXT NOT NULL,
    "material_id"     UUID NOT NULL,
    "qty"             DOUBLE PRECISION NOT NULL,
    "damage_category" "DamageCategory" NOT NULL,
    "location_id"     UUID,
    "status"          "DamagedStockStatus" NOT NULL DEFAULT 'REPORTED',
    "reported_by"     TEXT,
    "reported_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolution"      "DamagedResolution",
    "resolution_note" TEXT,
    "resolved_by"     TEXT,
    "resolved_at"     TIMESTAMP(3),
    "notes"           TEXT,
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "damaged_stock_records_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "damaged_stock_records_record_number_key" ON "damaged_stock_records"("record_number");
CREATE INDEX "damaged_stock_records_status_idx" ON "damaged_stock_records"("status");
ALTER TABLE "damaged_stock_records" ADD CONSTRAINT "damaged_stock_records_material_id_fkey"
    FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "damaged_stock_records" ADD CONSTRAINT "damaged_stock_records_location_id_fkey"
    FOREIGN KEY ("location_id") REFERENCES "storage_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "damaged_stock_records" ADD CONSTRAINT "damaged_stock_records_reported_by_fkey"
    FOREIGN KEY ("reported_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "damaged_stock_records" ADD CONSTRAINT "damaged_stock_records_resolved_by_fkey"
    FOREIGN KEY ("resolved_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TYPE "ReturnType" AS ENUM ('CUSTOMER_RETURN', 'DELIVERY_RETURN', 'PRODUCTION_RETURN', 'SUPPLIER_RETURN');
CREATE TYPE "ReturnRecordStatus" AS ENUM ('CREATED', 'RECEIVED', 'INSPECTION', 'COMPLETED', 'CANCELLED');
CREATE TYPE "ReturnResolution" AS ENUM (
  'RETURN_TO_AVAILABLE', 'QUARANTINE', 'REWORK', 'RETURN_TO_SUPPLIER', 'DISPOSE', 'REPLACE_PRODUCT'
);

CREATE TABLE "return_records" (
    "id"              UUID NOT NULL,
    "return_number"   TEXT NOT NULL,
    "return_type"     "ReturnType" NOT NULL,
    "reference"       TEXT,
    "material_id"     UUID NOT NULL,
    "qty"             DOUBLE PRECISION NOT NULL,
    "condition"       TEXT,
    "status"          "ReturnRecordStatus" NOT NULL DEFAULT 'CREATED',
    "inspection_note" TEXT,
    "resolution"      "ReturnResolution",
    "created_by"      TEXT,
    "received_at"     TIMESTAMP(3),
    "inspected_at"    TIMESTAMP(3),
    "completed_at"    TIMESTAMP(3),
    "notes"           TEXT,
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "return_records_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "return_records_return_number_key" ON "return_records"("return_number");
CREATE INDEX "return_records_status_idx" ON "return_records"("status");
ALTER TABLE "return_records" ADD CONSTRAINT "return_records_material_id_fkey"
    FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "return_records" ADD CONSTRAINT "return_records_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TYPE "AdjustmentRequestType" AS ENUM (
  'POSITIVE', 'NEGATIVE', 'COUNT_DIFFERENCE', 'DAMAGE', 'EXPIRY', 'DATA_CORRECTION', 'CONVERSION', 'OTHER'
);
CREATE TYPE "AdjustmentRequestStatus" AS ENUM ('DRAFT', 'WAITING_APPROVAL', 'APPROVED', 'POSTED', 'CANCELLED');

CREATE TABLE "stock_adjustment_requests" (
    "id"                UUID NOT NULL,
    "adjustment_number" TEXT NOT NULL,
    "adjustment_type"   "AdjustmentRequestType" NOT NULL,
    "material_id"       UUID NOT NULL,
    "before_qty"        DOUBLE PRECISION NOT NULL,
    "adjustment_qty"    DOUBLE PRECISION NOT NULL,
    "reason"            TEXT NOT NULL,
    "status"            "AdjustmentRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "requested_by"      TEXT,
    "approved_by"       TEXT,
    "approved_at"       TIMESTAMP(3),
    "posted_by"         TEXT,
    "posted_at"         TIMESTAMP(3),
    "notes"             TEXT,
    "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"        TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_adjustment_requests_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "stock_adjustment_requests_adjustment_number_key" ON "stock_adjustment_requests"("adjustment_number");
CREATE INDEX "stock_adjustment_requests_status_idx" ON "stock_adjustment_requests"("status");
ALTER TABLE "stock_adjustment_requests" ADD CONSTRAINT "stock_adjustment_requests_material_id_fkey"
    FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_adjustment_requests" ADD CONSTRAINT "stock_adjustment_requests_requested_by_fkey"
    FOREIGN KEY ("requested_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stock_adjustment_requests" ADD CONSTRAINT "stock_adjustment_requests_approved_by_fkey"
    FOREIGN KEY ("approved_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stock_adjustment_requests" ADD CONSTRAINT "stock_adjustment_requests_posted_by_fkey"
    FOREIGN KEY ("posted_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "stock_movements" ADD COLUMN "damaged_stock_record_id" UUID;
ALTER TABLE "stock_movements" ADD COLUMN "return_record_id" UUID;
ALTER TABLE "stock_movements" ADD COLUMN "stock_adjustment_request_id" UUID;

CREATE INDEX "stock_movements_damaged_stock_record_id_idx" ON "stock_movements"("damaged_stock_record_id");
CREATE INDEX "stock_movements_return_record_id_idx" ON "stock_movements"("return_record_id");
CREATE INDEX "stock_movements_stock_adjustment_request_id_idx" ON "stock_movements"("stock_adjustment_request_id");

ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_damaged_stock_record_id_fkey"
    FOREIGN KEY ("damaged_stock_record_id") REFERENCES "damaged_stock_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_return_record_id_fkey"
    FOREIGN KEY ("return_record_id") REFERENCES "return_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_stock_adjustment_request_id_fkey"
    FOREIGN KEY ("stock_adjustment_request_id") REFERENCES "stock_adjustment_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
