-- Warehouse Tahap 2B — Goods Receipt sebagai dokumen proses.
--
-- KENAPA. v1 inventory (routes/inventory.js) cuma punya
-- POST /movements/receipt — satu langkah, langsung tercatat ke ledger.
-- Cukup untuk "barang sudah di tangan, catat sekarang", tapi tidak bisa
-- menjawab "supplier X mau kirim apa besok?" — itu butuh mencatat
-- EKSPEKTASI sebelum barang tiba dan sebelum diinspeksi.
--
-- PRINSIP INTI (TIDAK DILANGGAR): dokumen ini TIDAK PERNAH menyimpan angka
-- stok. Ia menyimpan status proses. Baris stock_movements RECEIPT baru
-- ditulis saat putaway dikonfirmasi — saldo TETAP murni turunan ledger
-- (PRD §8.1), sama seperti sebelum migrasi ini.
--
-- AMAN SEKARANG: materials & stock_movements masih KOSONG di production —
-- tidak ada goods receipt historis yang perlu direkonstruksi dari ledger
-- yang sudah telanjur tertulis satu langkah.

CREATE TYPE "ReceiptSourceType" AS ENUM (
  'PURCHASE_ORDER', 'SUPPLIER_DELIVERY', 'PRODUCTION_RETURN',
  'CUSTOMER_RETURN', 'INTER_WAREHOUSE_TRANSFER', 'MANUAL'
);

CREATE TYPE "ReceiptStatus" AS ENUM (
  'DRAFT', 'SCHEDULED', 'ARRIVED', 'INSPECTION',
  'READY_FOR_PUTAWAY', 'COMPLETED', 'REJECTED'
);

CREATE TABLE "goods_receipts" (
    "id"               UUID NOT NULL,
    "receipt_number"   TEXT NOT NULL,
    "source_type"      "ReceiptSourceType" NOT NULL,
    "source_reference" TEXT,
    "supplier"         TEXT,
    "expected_date"    DATE,
    "received_date"    DATE,
    "delivery_note"    TEXT,
    "notes"            TEXT,
    "status"           "ReceiptStatus" NOT NULL DEFAULT 'DRAFT',
    "created_by"       TEXT,
    "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "goods_receipts_receipt_number_key" ON "goods_receipts"("receipt_number");
CREATE INDEX "goods_receipts_status_idx" ON "goods_receipts"("status");
CREATE INDEX "goods_receipts_expected_date_idx" ON "goods_receipts"("expected_date");

CREATE TABLE "goods_receipt_lines" (
    "id"               UUID NOT NULL,
    "goods_receipt_id" UUID NOT NULL,
    "material_id"      UUID NOT NULL,
    "ordered_qty"      DOUBLE PRECISION,
    "received_qty"     DOUBLE PRECISION,
    "accepted_qty"     DOUBLE PRECISION,
    "rejected_qty"     DOUBLE PRECISION,
    "condition"        TEXT,
    "notes"            TEXT,

    CONSTRAINT "goods_receipt_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "goods_receipt_lines_goods_receipt_id_idx" ON "goods_receipt_lines"("goods_receipt_id");
CREATE INDEX "goods_receipt_lines_material_id_idx" ON "goods_receipt_lines"("material_id");

ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_goods_receipt_id_fkey"
    FOREIGN KEY ("goods_receipt_id") REFERENCES "goods_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_material_id_fkey"
    FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Jejak balik dari ledger ke dokumen yang menghasilkannya. NULLABLE:
-- movement RECEIPT lama (sebelum GoodsReceipt ada) dan movement non-RECEIPT
-- tidak punya dokumen sumber. SetNull: menghapus draft GoodsReceipt yang
-- batal tidak boleh menghapus jejak stok yang sudah kadung tercatat.
ALTER TABLE "stock_movements" ADD COLUMN "goods_receipt_id" UUID;
CREATE INDEX "stock_movements_goods_receipt_id_idx" ON "stock_movements"("goods_receipt_id");
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_goods_receipt_id_fkey"
    FOREIGN KEY ("goods_receipt_id") REFERENCES "goods_receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
