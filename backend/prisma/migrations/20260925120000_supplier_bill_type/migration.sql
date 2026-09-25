-- B3.3 Tagihan Supplier Bahan Baku — ADITIF (kolom opsional + FK). Tagihan lama tidak diubah (bill_type NULL).
ALTER TABLE "fin_supplier_bills" ADD COLUMN "bill_type" VARCHAR(40), ADD COLUMN "purchase_category_id" UUID;
ALTER TABLE "fin_supplier_bills" ADD CONSTRAINT "fin_supplier_bills_purchase_category_id_fkey" FOREIGN KEY ("purchase_category_id") REFERENCES "fin_purchase_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
