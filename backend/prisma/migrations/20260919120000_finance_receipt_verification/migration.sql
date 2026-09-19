-- Verifikasi bukti (nota) pengeluaran & pembelian — additive, tidak menyentuh data lama.
ALTER TABLE "fin_expenses"
  ADD COLUMN "receipt_verified_at" TIMESTAMP(3),
  ADD COLUMN "receipt_verified_by" TEXT;
ALTER TABLE "fin_purchases"
  ADD COLUMN "receipt_verified_at" TIMESTAMP(3),
  ADD COLUMN "receipt_verified_by" TEXT;

CREATE INDEX "fin_expenses_receipt_url_idx" ON "fin_expenses"("receipt_url");
CREATE INDEX "fin_purchases_receipt_url_idx" ON "fin_purchases"("receipt_url");

ALTER TABLE "fin_expenses" ADD CONSTRAINT "fin_expenses_receipt_verified_by_fkey"
  FOREIGN KEY ("receipt_verified_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "fin_purchases" ADD CONSTRAINT "fin_purchases_receipt_verified_by_fkey"
  FOREIGN KEY ("receipt_verified_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
