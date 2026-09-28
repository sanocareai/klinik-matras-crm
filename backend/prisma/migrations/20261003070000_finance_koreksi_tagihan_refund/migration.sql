-- B3.8 Koreksi Finance Lanjutan (tagihan supplier & refund) — murni aditif: kolom nullable baru, baris lama = NULL.
ALTER TABLE "fin_supplier_bills" ADD COLUMN "replaces_bill_id" UUID;
CREATE UNIQUE INDEX "fin_supplier_bills_replaces_bill_id_key" ON "fin_supplier_bills"("replaces_bill_id");
ALTER TABLE "fin_supplier_bills" ADD CONSTRAINT "fin_supplier_bills_replaces_bill_id_fkey" FOREIGN KEY ("replaces_bill_id") REFERENCES "fin_supplier_bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "fin_refunds" ADD COLUMN "replaces_refund_id" UUID;
CREATE UNIQUE INDEX "fin_refunds_replaces_refund_id_key" ON "fin_refunds"("replaces_refund_id");
ALTER TABLE "fin_refunds" ADD CONSTRAINT "fin_refunds_replaces_refund_id_fkey" FOREIGN KEY ("replaces_refund_id") REFERENCES "fin_refunds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
