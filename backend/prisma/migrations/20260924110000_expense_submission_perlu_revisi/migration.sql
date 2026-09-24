-- PERLU_REVISI pada Pengajuan Biaya (24 September 2026). ADITIF MURNI:
-- satu nilai enum baru + tiga kolom nullable + satu FK (SET NULL). Tidak ada data
-- lama yang diubah, tidak ada DROP/ALTER tipe kolom. Baris lama tetap valid.

-- AlterEnum
ALTER TYPE "ExpenseSubmissionStatus" ADD VALUE 'PERLU_REVISI';

-- AlterTable
ALTER TABLE "expense_submissions"
  ADD COLUMN "revision_reason" TEXT,
  ADD COLUMN "revision_requested_by" TEXT,
  ADD COLUMN "revision_requested_at" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "expense_submissions" ADD CONSTRAINT "expense_submissions_revision_requested_by_fkey" FOREIGN KEY ("revision_requested_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
