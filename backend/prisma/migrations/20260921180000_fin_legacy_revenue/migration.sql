-- Data Sebelum Sistem: register pendapatan historis NON-POSTING (aditif; tidak menyentuh ledger, kas, invoice, atau data lama).
CREATE TYPE "FinLegacyBatchStatus" AS ENUM ('PREVIEW', 'IMPORTED', 'CANCELLED', 'POSTED');
CREATE TYPE "FinLegacyRowStatus" AS ENUM ('SIAP', 'PERLU_DITINJAU', 'DUPLIKAT', 'DI_LUAR_PERIODE', 'TIDAK_VALID');
CREATE TYPE "FinLegacyPayStatus" AS ENUM ('LUNAS', 'SEBAGIAN', 'BELUM_BAYAR', 'TIDAK_DIKETAHUI');

CREATE TABLE "fin_legacy_batches" (
    "id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_hash" TEXT NOT NULL,
    "sumber_data" TEXT,
    "cutoff_date" DATE NOT NULL,
    "status" "FinLegacyBatchStatus" NOT NULL DEFAULT 'PREVIEW',
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "imported_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by" TEXT,
    "cancel_reason" TEXT,
    "posted_at" TIMESTAMP(3),
    CONSTRAINT "fin_legacy_batches_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "fin_legacy_batches_status_idx" ON "fin_legacy_batches"("status");
CREATE INDEX "fin_legacy_batches_file_hash_idx" ON "fin_legacy_batches"("file_hash");

CREATE TABLE "fin_legacy_revenues" (
    "id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "row_no" INTEGER NOT NULL,
    "legacy_id" TEXT NOT NULL,
    "nomor_lama" TEXT,
    "trx_date" DATE,
    "customer_name" TEXT,
    "description" TEXT,
    "amount" DECIMAL(18,2),
    "pay_status" "FinLegacyPayStatus" NOT NULL DEFAULT 'TIDAK_DIKETAHUI',
    "paid_amount" DECIMAL(18,2),
    "paid_date" DATE,
    "pay_method" TEXT,
    "cash_account_name" TEXT,
    "source_label" TEXT,
    "status" "FinLegacyRowStatus" NOT NULL DEFAULT 'SIAP',
    "review_reason" TEXT,
    "matched_order_id" TEXT,
    "matched_legacy_id" TEXT,
    "decision" TEXT,
    "decided_by" TEXT,
    "decided_at" TIMESTAMP(3),
    "raw" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fin_legacy_revenues_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "fin_legacy_revenues_batch_id_legacy_id_key" ON "fin_legacy_revenues"("batch_id", "legacy_id");
CREATE INDEX "fin_legacy_revenues_status_idx" ON "fin_legacy_revenues"("status");
CREATE INDEX "fin_legacy_revenues_trx_date_idx" ON "fin_legacy_revenues"("trx_date");
CREATE INDEX "fin_legacy_revenues_legacy_id_idx" ON "fin_legacy_revenues"("legacy_id");
ALTER TABLE "fin_legacy_revenues" ADD CONSTRAINT "fin_legacy_revenues_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "fin_legacy_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
