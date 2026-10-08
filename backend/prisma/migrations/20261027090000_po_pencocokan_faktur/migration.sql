-- AlterTable
ALTER TABLE "fin_supplier_bills" ADD COLUMN     "po_review_note" TEXT,
ADD COLUMN     "po_reviewed_at" TIMESTAMP(3),
ADD COLUMN     "po_reviewed_by" TEXT,
ADD COLUMN     "purchase_order_id" UUID;

-- CreateTable
CREATE TABLE "fin_supplier_bill_po_lines" (
    "id" UUID NOT NULL,
    "bill_id" UUID NOT NULL,
    "purchase_order_line_id" UUID NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "invoice_unit_price" DECIMAL(18,2) NOT NULL,
    "po_unit_price" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "fin_supplier_bill_po_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_supplier_bill_po_receipts" (
    "id" UUID NOT NULL,
    "bill_id" UUID NOT NULL,
    "goods_receipt_id" UUID NOT NULL,

    CONSTRAINT "fin_supplier_bill_po_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_supplier_bill_allocations" (
    "id" UUID NOT NULL,
    "bill_id" UUID NOT NULL,
    "bill_po_line_id" UUID NOT NULL,
    "goods_receipt_id" UUID NOT NULL,
    "goods_receipt_line_id" UUID NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "po_unit_price" INTEGER NOT NULL,
    "po_value" DECIMAL(18,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_supplier_bill_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fin_supplier_bill_po_lines_purchase_order_line_id_idx" ON "fin_supplier_bill_po_lines"("purchase_order_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "fin_supplier_bill_po_lines_bill_id_purchase_order_line_id_key" ON "fin_supplier_bill_po_lines"("bill_id", "purchase_order_line_id");

-- CreateIndex
CREATE INDEX "fin_supplier_bill_po_receipts_goods_receipt_id_idx" ON "fin_supplier_bill_po_receipts"("goods_receipt_id");

-- CreateIndex
CREATE UNIQUE INDEX "fin_supplier_bill_po_receipts_bill_id_goods_receipt_id_key" ON "fin_supplier_bill_po_receipts"("bill_id", "goods_receipt_id");

-- CreateIndex
CREATE INDEX "fin_supplier_bill_allocations_bill_id_idx" ON "fin_supplier_bill_allocations"("bill_id");

-- CreateIndex
CREATE INDEX "fin_supplier_bill_allocations_goods_receipt_line_id_idx" ON "fin_supplier_bill_allocations"("goods_receipt_line_id");

-- CreateIndex
CREATE INDEX "fin_supplier_bill_allocations_goods_receipt_id_idx" ON "fin_supplier_bill_allocations"("goods_receipt_id");

-- CreateIndex
CREATE INDEX "fin_supplier_bills_purchase_order_id_idx" ON "fin_supplier_bills"("purchase_order_id");

-- AddForeignKey
ALTER TABLE "fin_supplier_bills" ADD CONSTRAINT "fin_supplier_bills_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "fin_purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_supplier_bill_po_lines" ADD CONSTRAINT "fin_supplier_bill_po_lines_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "fin_supplier_bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_supplier_bill_po_lines" ADD CONSTRAINT "fin_supplier_bill_po_lines_purchase_order_line_id_fkey" FOREIGN KEY ("purchase_order_line_id") REFERENCES "fin_purchase_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_supplier_bill_po_receipts" ADD CONSTRAINT "fin_supplier_bill_po_receipts_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "fin_supplier_bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_supplier_bill_po_receipts" ADD CONSTRAINT "fin_supplier_bill_po_receipts_goods_receipt_id_fkey" FOREIGN KEY ("goods_receipt_id") REFERENCES "goods_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_supplier_bill_allocations" ADD CONSTRAINT "fin_supplier_bill_allocations_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "fin_supplier_bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_supplier_bill_allocations" ADD CONSTRAINT "fin_supplier_bill_allocations_bill_po_line_id_fkey" FOREIGN KEY ("bill_po_line_id") REFERENCES "fin_supplier_bill_po_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_supplier_bill_allocations" ADD CONSTRAINT "fin_supplier_bill_allocations_goods_receipt_id_fkey" FOREIGN KEY ("goods_receipt_id") REFERENCES "goods_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_supplier_bill_allocations" ADD CONSTRAINT "fin_supplier_bill_allocations_goods_receipt_line_id_fkey" FOREIGN KEY ("goods_receipt_line_id") REFERENCES "goods_receipt_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Pengaman data: jumlah dan harga faktur selalu positif; klaim alokasi tidak boleh nol; nilai alokasi tidak negatif.
ALTER TABLE "fin_supplier_bill_po_lines" ADD CONSTRAINT "fin_supplier_bill_po_lines_qty_positif" CHECK ("qty" > 0 AND "invoice_unit_price" > 0 AND "po_unit_price" > 0);
ALTER TABLE "fin_supplier_bill_allocations" ADD CONSTRAINT "fin_supplier_bill_allocations_qty_positif" CHECK ("qty" > 0 AND "po_value" >= 0);
