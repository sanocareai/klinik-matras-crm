-- B3.7 Koreksi Pembayaran Masuk Terverifikasi — murni aditif: kolom nullable baru di payments, baris lama = NULL.
ALTER TABLE "payments" ADD COLUMN "reference_number" TEXT;
ALTER TABLE "payments" ADD COLUMN "notes" TEXT;
ALTER TABLE "payments" ADD COLUMN "internal_note" TEXT;
ALTER TABLE "payments" ADD COLUMN "replaces_payment_id" UUID;

CREATE UNIQUE INDEX "payments_replaces_payment_id_key" ON "payments"("replaces_payment_id");

ALTER TABLE "payments" ADD CONSTRAINT "payments_replaces_payment_id_fkey" FOREIGN KEY ("replaces_payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
