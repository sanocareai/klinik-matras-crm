-- Termin Pembayaran & Aging Utang Supplier — ADITIF: hanya kolom baru NULLABLE (tanpa default yang mengubah baris lama), satu FK, CHECK untuk kolom baru.
-- Tidak ada UPDATE/DELETE/backfill: tagihan, PO, dan supplier lama tetap persis seperti sebelumnya (jatuh tempo lama tidak ditebak).

-- AlterTable
ALTER TABLE "fin_suppliers" ADD COLUMN     "payment_term_type" VARCHAR(20);

-- AlterTable
ALTER TABLE "fin_purchase_orders" ADD COLUMN     "term_type" VARCHAR(20),
ADD COLUMN     "term_days" INTEGER,
ADD COLUMN     "term_source" VARCHAR(20),
ADD COLUMN     "term_override_reason" TEXT,
ADD COLUMN     "term_set_by" TEXT,
ADD COLUMN     "term_set_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "fin_supplier_bills" ADD COLUMN     "term_type" VARCHAR(20),
ADD COLUMN     "term_days" INTEGER,
ADD COLUMN     "term_basis" VARCHAR(30),
ADD COLUMN     "term_source" VARCHAR(20),
ADD COLUMN     "term_override_reason" TEXT,
ADD COLUMN     "term_set_by" TEXT,
ADD COLUMN     "term_set_at" TIMESTAMP(3),
ADD COLUMN     "scheduled_pay_date" DATE,
ADD COLUMN     "scheduled_cash_account_id" UUID,
ADD COLUMN     "scheduled_note" TEXT,
ADD COLUMN     "scheduled_by" TEXT,
ADD COLUMN     "scheduled_at" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "fin_supplier_bills" ADD CONSTRAINT "fin_supplier_bills_scheduled_cash_account_id_fkey" FOREIGN KEY ("scheduled_cash_account_id") REFERENCES "fin_cash_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "fin_supplier_bills_scheduled_pay_date_idx" ON "fin_supplier_bills"("scheduled_pay_date");

-- Constraints untuk kolom baru (NULL selalu lolos — baris lama tidak terpengaruh)
ALTER TABLE "fin_suppliers" ADD CONSTRAINT "fin_suppliers_payment_term_type_chk" CHECK ("payment_term_type" IS NULL OR "payment_term_type" IN ('TUNAI', 'HARI', 'TANGGAL_KHUSUS'));
ALTER TABLE "fin_purchase_orders" ADD CONSTRAINT "fin_purchase_orders_term_chk" CHECK (("term_type" IS NULL OR "term_type" IN ('TUNAI', 'HARI', 'TANGGAL_KHUSUS')) AND ("term_source" IS NULL OR "term_source" IN ('MASTER_SUPPLIER', 'PO', 'OVERRIDE_FAKTUR')) AND ("term_days" IS NULL OR "term_days" BETWEEN 0 AND 365));
ALTER TABLE "fin_supplier_bills" ADD CONSTRAINT "fin_supplier_bills_term_chk" CHECK (("term_type" IS NULL OR "term_type" IN ('TUNAI', 'HARI', 'TANGGAL_KHUSUS')) AND ("term_source" IS NULL OR "term_source" IN ('MASTER_SUPPLIER', 'PO', 'OVERRIDE_FAKTUR')) AND ("term_days" IS NULL OR "term_days" BETWEEN 0 AND 365) AND ("term_basis" IS NULL OR "term_basis" IN ('TANGGAL_FAKTUR')));
