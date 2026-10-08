-- CreateEnum
CREATE TYPE "FinPurchaseOrderStatus" AS ENUM ('DRAFT', 'DISETUJUI', 'DITERIMA_SEBAGIAN', 'SELESAI', 'DIBATALKAN');

-- AlterTable
ALTER TABLE "goods_receipts" ADD COLUMN     "purchase_order_id" UUID;

-- AlterTable
ALTER TABLE "goods_receipt_lines" ADD COLUMN     "purchase_order_line_id" UUID;

-- CreateTable
CREATE TABLE "fin_purchase_orders" (
    "id" UUID NOT NULL,
    "po_number" TEXT NOT NULL,
    "supplier_id" UUID NOT NULL,
    "order_date" DATE NOT NULL,
    "expected_date" DATE,
    "notes" TEXT,
    "status" "FinPurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "created_by" TEXT,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fin_purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_purchase_order_lines" (
    "id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "material_id" UUID NOT NULL,
    "unit" TEXT NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "unit_price" INTEGER NOT NULL,
    "notes" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "fin_purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_purchase_order_events" (
    "id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "type" VARCHAR(40) NOT NULL,
    "actor_id" TEXT,
    "note" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_purchase_order_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fin_purchase_orders_po_number_key" ON "fin_purchase_orders"("po_number");

-- CreateIndex
CREATE INDEX "fin_purchase_orders_supplier_id_status_idx" ON "fin_purchase_orders"("supplier_id", "status");

-- CreateIndex
CREATE INDEX "fin_purchase_orders_status_idx" ON "fin_purchase_orders"("status");

-- CreateIndex
CREATE INDEX "fin_purchase_order_lines_purchase_order_id_idx" ON "fin_purchase_order_lines"("purchase_order_id");

-- CreateIndex
CREATE INDEX "fin_purchase_order_lines_material_id_idx" ON "fin_purchase_order_lines"("material_id");

-- CreateIndex
CREATE INDEX "fin_purchase_order_events_purchase_order_id_created_at_idx" ON "fin_purchase_order_events"("purchase_order_id", "created_at");

-- CreateIndex
CREATE INDEX "goods_receipts_purchase_order_id_idx" ON "goods_receipts"("purchase_order_id");

-- CreateIndex
CREATE INDEX "goods_receipt_lines_purchase_order_line_id_idx" ON "goods_receipt_lines"("purchase_order_line_id");

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "fin_purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_purchase_order_line_id_fkey" FOREIGN KEY ("purchase_order_line_id") REFERENCES "fin_purchase_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_purchase_orders" ADD CONSTRAINT "fin_purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "fin_suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_purchase_orders" ADD CONSTRAINT "fin_purchase_orders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_purchase_orders" ADD CONSTRAINT "fin_purchase_orders_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_purchase_order_lines" ADD CONSTRAINT "fin_purchase_order_lines_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "fin_purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_purchase_order_lines" ADD CONSTRAINT "fin_purchase_order_lines_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_purchase_order_events" ADD CONSTRAINT "fin_purchase_order_events_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "fin_purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_purchase_order_events" ADD CONSTRAINT "fin_purchase_order_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

