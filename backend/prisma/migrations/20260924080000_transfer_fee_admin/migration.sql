-- Biaya admin transfer bank: kolom aditif, baris lama tidak berubah (default 0 / NULL).
ALTER TABLE "fin_supplier_payments" ADD COLUMN "payment_method" TEXT, ADD COLUMN "transfer_fee_type" TEXT, ADD COLUMN "transfer_fee_amount" DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE "fin_refunds" ADD COLUMN "payment_method" TEXT, ADD COLUMN "transfer_fee_type" TEXT, ADD COLUMN "transfer_fee_amount" DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE "fin_expenses" ADD COLUMN "payment_method" TEXT, ADD COLUMN "transfer_fee_type" TEXT, ADD COLUMN "transfer_fee_amount" DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE "fin_purchases" ADD COLUMN "payment_method" TEXT, ADD COLUMN "transfer_fee_type" TEXT, ADD COLUMN "transfer_fee_amount" DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE "fin_kasbon" ADD COLUMN "payment_method" TEXT, ADD COLUMN "transfer_fee_type" TEXT, ADD COLUMN "transfer_fee_amount" DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE "fin_cash_accounts" ADD COLUMN "transfer_fee_presets" JSONB;
