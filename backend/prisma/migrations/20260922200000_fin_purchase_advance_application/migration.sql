-- Terapkan Uang Muka Pembelian (D-XXX, 22 September 2026) — aditif murni.
-- Tidak mengubah kolom/tabel yang sudah ada, tidak menyentuh data yang
-- sudah ada. Lihat schema.prisma model FinPurchaseAdvanceApplication untuk
-- konteks lengkap.

-- CreateEnum
CREATE TYPE "FinAdvanceApplicationStatus" AS ENUM ('ACTIVE', 'REVERSED');

-- AlterEnum
ALTER TYPE "FinJournalSource" ADD VALUE 'TERAPKAN_UANG_MUKA';

-- CreateTable
CREATE TABLE "fin_purchase_advance_applications" (
    "id" UUID NOT NULL,
    "advance_purchase_id" UUID NOT NULL,
    "target_purchase_id" UUID NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "journal_id" UUID NOT NULL,
    "reversal_journal_id" UUID,
    "status" "FinAdvanceApplicationStatus" NOT NULL DEFAULT 'ACTIVE',
    "idempotency_key" TEXT NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversed_by" TEXT,
    "reversed_at" TIMESTAMP(3),
    "reverse_reason" TEXT,

    CONSTRAINT "fin_purchase_advance_applications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fin_purchase_advance_applications_journal_id_key" ON "fin_purchase_advance_applications"("journal_id");

-- CreateIndex
CREATE UNIQUE INDEX "fin_purchase_advance_applications_reversal_journal_id_key" ON "fin_purchase_advance_applications"("reversal_journal_id");

-- CreateIndex
CREATE UNIQUE INDEX "fin_purchase_advance_applications_idempotency_key_key" ON "fin_purchase_advance_applications"("idempotency_key");

-- CreateIndex
CREATE INDEX "fin_purchase_advance_applications_advance_purchase_id_statu_idx" ON "fin_purchase_advance_applications"("advance_purchase_id", "status");

-- CreateIndex
CREATE INDEX "fin_purchase_advance_applications_target_purchase_id_status_idx" ON "fin_purchase_advance_applications"("target_purchase_id", "status");

-- AddForeignKey
ALTER TABLE "fin_purchase_advance_applications" ADD CONSTRAINT "fin_purchase_advance_applications_advance_purchase_id_fkey" FOREIGN KEY ("advance_purchase_id") REFERENCES "fin_purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_purchase_advance_applications" ADD CONSTRAINT "fin_purchase_advance_applications_target_purchase_id_fkey" FOREIGN KEY ("target_purchase_id") REFERENCES "fin_purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_purchase_advance_applications" ADD CONSTRAINT "fin_purchase_advance_applications_journal_id_fkey" FOREIGN KEY ("journal_id") REFERENCES "fin_journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_purchase_advance_applications" ADD CONSTRAINT "fin_purchase_advance_applications_reversal_journal_id_fkey" FOREIGN KEY ("reversal_journal_id") REFERENCES "fin_journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_purchase_advance_applications" ADD CONSTRAINT "fin_purchase_advance_applications_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_purchase_advance_applications" ADD CONSTRAINT "fin_purchase_advance_applications_reversed_by_fkey" FOREIGN KEY ("reversed_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
