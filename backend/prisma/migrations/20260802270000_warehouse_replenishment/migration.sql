-- Warehouse Tahap 7 — Replenishment.
--
-- KENAPA GRATIS SEKARANG. Material.reorder_point & reorder_qty sudah ada
-- SEJAK v1 tapi belum pernah dipakai jadi saran — cuma alarm senyap.
-- reorderPoint = pemicu ("kapan"), reorderQty = jawaban "Suggested
-- Quantity" dari spesifikasi. TIDAK ADA "Maximum Stock" yang dikarang.
--
-- Saran TIDAK PERNAH disimpan sebagai baris — dihitung on-the-fly
-- (available <= reorderPoint), sama disiplin dengan saldo stok itu sendiri.
-- Baru jadi baris nyata begitu "Create Request" diklik.
--
-- TIDAK PERNAH menulis stock_movements sendiri — barang yang benar-benar
-- tiba dicatat lewat Goods Receipt seperti biasa. Selesainya replenishment
-- adalah MENAUTKAN ke GoodsReceipt yang sudah ada (goods_receipt_id).
--
-- IssuePriority (Tahap 3) DIPAKAI ULANG untuk kolom priority — bentuknya
-- identik (LOW/NORMAL/HIGH/URGENT), tidak didefinisikan ulang.

CREATE TYPE "ReplenishmentSource" AS ENUM (
  'MINIMUM_STOCK_RULE', 'REORDER_POINT', 'PRODUCTION_FORECAST',
  'SALES_DEMAND', 'MANUAL_REQUEST', 'LOCATION_REFILL'
);

CREATE TYPE "ReplenishmentStatus" AS ENUM (
  'DRAFT', 'WAITING_APPROVAL', 'APPROVED', 'ORDERED', 'COMPLETED', 'REJECTED'
);

CREATE TABLE "replenishment_requests" (
    "id"                     UUID NOT NULL,
    "request_number"         TEXT NOT NULL,
    "source"                 "ReplenishmentSource" NOT NULL,
    "material_id"            UUID NOT NULL,
    "current_stock_snapshot" DOUBLE PRECISION NOT NULL,
    "minimum_stock_snapshot" DOUBLE PRECISION,
    "suggested_qty"          DOUBLE PRECISION NOT NULL,
    "required_date"          DATE,
    "priority"               "IssuePriority" NOT NULL DEFAULT 'NORMAL',
    "supplier"               TEXT,
    "status"                 "ReplenishmentStatus" NOT NULL DEFAULT 'DRAFT',
    "requested_by"           TEXT,
    "approved_by"            TEXT,
    "approved_at"            TIMESTAMP(3),
    "ordered_at"             TIMESTAMP(3),
    "rejected_reason"        TEXT,
    "goods_receipt_id"       UUID,
    "notes"                  TEXT,
    "created_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"             TIMESTAMP(3) NOT NULL,

    CONSTRAINT "replenishment_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "replenishment_requests_request_number_key" ON "replenishment_requests"("request_number");
CREATE INDEX "replenishment_requests_status_idx" ON "replenishment_requests"("status");
CREATE INDEX "replenishment_requests_material_id_idx" ON "replenishment_requests"("material_id");

ALTER TABLE "replenishment_requests" ADD CONSTRAINT "replenishment_requests_material_id_fkey"
    FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "replenishment_requests" ADD CONSTRAINT "replenishment_requests_requested_by_fkey"
    FOREIGN KEY ("requested_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "replenishment_requests" ADD CONSTRAINT "replenishment_requests_approved_by_fkey"
    FOREIGN KEY ("approved_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "replenishment_requests" ADD CONSTRAINT "replenishment_requests_goods_receipt_id_fkey"
    FOREIGN KEY ("goods_receipt_id") REFERENCES "goods_receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
