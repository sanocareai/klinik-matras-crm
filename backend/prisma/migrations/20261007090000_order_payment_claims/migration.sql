-- Klaim Lunas Sales (1 Okt 2026): tabel BARU (kosong) untuk pengajuan klaim + berkas Bukti Pembayaran. Murni aditif — tidak menyentuh tabel lama
-- selain referensi FK ke Order/User/Payment/fin_cash_accounts (tanpa mengubah kolom mereka). Tidak ada data yang dipindah/diubah.
CREATE TYPE "KlaimLunasStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'EVIDENCE_REQUESTED', 'REJECTED', 'VERIFIED', 'CANCELLED');

CREATE TABLE "order_payment_claims" (
    "id" UUID NOT NULL,
    "order_id" TEXT NOT NULL,
    "status" "KlaimLunasStatus" NOT NULL DEFAULT 'DRAFT',
    "payment_date" VARCHAR(10),
    "amount" INTEGER,
    "method" "PaymentMethod",
    "cash_account_id" UUID,
    "note" TEXT,
    "created_by" TEXT NOT NULL,
    "submitted_at" TIMESTAMP(3),
    "submit_count" INTEGER NOT NULL DEFAULT 0,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "review_reason" TEXT,
    "payment_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_payment_claims_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "order_payment_claim_evidence" (
    "id" UUID NOT NULL,
    "claim_id" UUID NOT NULL,
    "stored_name" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "uploaded_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_payment_claim_evidence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "order_payment_claims_payment_id_key" ON "order_payment_claims"("payment_id");
CREATE INDEX "order_payment_claims_order_id_idx" ON "order_payment_claims"("order_id");
CREATE INDEX "order_payment_claims_status_idx" ON "order_payment_claims"("status");
CREATE INDEX "order_payment_claims_created_by_idx" ON "order_payment_claims"("created_by");
CREATE UNIQUE INDEX "order_payment_claim_evidence_stored_name_key" ON "order_payment_claim_evidence"("stored_name");
CREATE INDEX "order_payment_claim_evidence_claim_id_idx" ON "order_payment_claim_evidence"("claim_id");
CREATE INDEX "order_payment_claim_evidence_sha256_idx" ON "order_payment_claim_evidence"("sha256");

ALTER TABLE "order_payment_claims" ADD CONSTRAINT "order_payment_claims_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_payment_claims" ADD CONSTRAINT "order_payment_claims_cash_account_id_fkey" FOREIGN KEY ("cash_account_id") REFERENCES "fin_cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_payment_claims" ADD CONSTRAINT "order_payment_claims_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_payment_claims" ADD CONSTRAINT "order_payment_claims_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "order_payment_claims" ADD CONSTRAINT "order_payment_claims_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_payment_claim_evidence" ADD CONSTRAINT "order_payment_claim_evidence_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "order_payment_claims"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
