-- Metode KARTU + rekening tujuan yang dipilih pencatat pembayaran. Additive:
-- baris lama tetap valid (cash_account_id NULL = pakai pemetaan per-metode).
ALTER TYPE "PaymentMethod" ADD VALUE 'CARD';

ALTER TABLE "payments" ADD COLUMN "cash_account_id" UUID;
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_cash_account_id_fkey"
  FOREIGN KEY ("cash_account_id") REFERENCES "fin_cash_accounts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "payments_cash_account_id_idx" ON "payments"("cash_account_id");
