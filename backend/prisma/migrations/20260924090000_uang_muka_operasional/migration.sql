-- Modul Uang Muka Operasional: aditif. Data lama tidak diubah kecuali penandaan needs_review.
-- CreateEnum
CREATE TYPE "FinAdvanceStatus" AS ENUM ('AKTIF', 'SEBAGIAN', 'SELESAI', 'DIBATALKAN');

-- CreateEnum
CREATE TYPE "FinAdvanceSettlementType" AS ENUM ('PERTANGGUNGJAWABAN', 'PENGEMBALIAN');

-- CreateEnum
CREATE TYPE "FinAdvanceSettlementStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- AlterEnum
ALTER TYPE "FinExpenseMode" ADD VALUE 'UANG_MUKA';

-- AlterEnum
ALTER TYPE "FinJournalSource" ADD VALUE 'UANG_MUKA_OPERASIONAL';

-- AlterTable
ALTER TABLE "expense_submissions" ADD COLUMN     "advance_id" UUID,
ADD COLUMN     "needs_review" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "review_note" TEXT;

-- AlterTable
ALTER TABLE "fin_expenses" ADD COLUMN     "advance_applied_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "advance_id" UUID;

-- CreateTable
CREATE TABLE "fin_operational_advances" (
    "id" UUID NOT NULL,
    "advance_number" TEXT NOT NULL,
    "holder_id" TEXT NOT NULL,
    "division" "FinDivision" NOT NULL DEFAULT 'UMUM',
    "purpose" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "due_date" DATE,
    "amount" DECIMAL(18,2) NOT NULL,
    "cash_account_id" UUID NOT NULL,
    "payment_method" TEXT,
    "transfer_fee_type" TEXT,
    "transfer_fee_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "receipt_url" TEXT,
    "notes" TEXT,
    "status" "FinAdvanceStatus" NOT NULL DEFAULT 'AKTIF',
    "idempotency_key" TEXT,
    "created_by" TEXT NOT NULL,
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by" TEXT,
    "cancel_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fin_operational_advances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_operational_advance_settlements" (
    "id" UUID NOT NULL,
    "advance_id" UUID NOT NULL,
    "type" "FinAdvanceSettlementType" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "date" DATE NOT NULL,
    "expense_id" UUID,
    "cash_account_id" UUID,
    "note" TEXT,
    "receipt_url" TEXT,
    "status" "FinAdvanceSettlementStatus" NOT NULL DEFAULT 'ACTIVE',
    "idempotency_key" TEXT,
    "created_by" TEXT NOT NULL,
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by" TEXT,
    "cancel_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_operational_advance_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fin_operational_advances_advance_number_key" ON "fin_operational_advances"("advance_number");

-- CreateIndex
CREATE UNIQUE INDEX "fin_operational_advances_idempotency_key_key" ON "fin_operational_advances"("idempotency_key");

-- CreateIndex
CREATE INDEX "fin_operational_advances_holder_id_status_idx" ON "fin_operational_advances"("holder_id", "status");

-- CreateIndex
CREATE INDEX "fin_operational_advances_status_due_date_idx" ON "fin_operational_advances"("status", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "fin_operational_advance_settlements_idempotency_key_key" ON "fin_operational_advance_settlements"("idempotency_key");

-- CreateIndex
CREATE INDEX "fin_operational_advance_settlements_advance_id_status_idx" ON "fin_operational_advance_settlements"("advance_id", "status");

-- CreateIndex
CREATE INDEX "Conversation_customerId_channel_idx" ON "Conversation"("customerId", "channel");

-- AddForeignKey
ALTER TABLE "expense_submissions" ADD CONSTRAINT "expense_submissions_advance_id_fkey" FOREIGN KEY ("advance_id") REFERENCES "fin_operational_advances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_expenses" ADD CONSTRAINT "fin_expenses_advance_id_fkey" FOREIGN KEY ("advance_id") REFERENCES "fin_operational_advances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_operational_advances" ADD CONSTRAINT "fin_operational_advances_holder_id_fkey" FOREIGN KEY ("holder_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_operational_advances" ADD CONSTRAINT "fin_operational_advances_cash_account_id_fkey" FOREIGN KEY ("cash_account_id") REFERENCES "fin_cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_operational_advances" ADD CONSTRAINT "fin_operational_advances_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_operational_advance_settlements" ADD CONSTRAINT "fin_operational_advance_settlements_advance_id_fkey" FOREIGN KEY ("advance_id") REFERENCES "fin_operational_advances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_operational_advance_settlements" ADD CONSTRAINT "fin_operational_advance_settlements_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "fin_expenses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_operational_advance_settlements" ADD CONSTRAINT "fin_operational_advance_settlements_cash_account_id_fkey" FOREIGN KEY ("cash_account_id") REFERENCES "fin_cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ═════════════════════════════════════════════════════════════════════════
-- Bagian kustom (tidak dihasilkan Prisma)
-- ═════════════════════════════════════════════════════════════════════════

-- Pemakaian ganda mustahil: satu pengeluaran hanya boleh punya SATU pertanggungjawaban ACTIVE.
CREATE UNIQUE INDEX "fin_adv_settlement_expense_active_key"
  ON "fin_operational_advance_settlements"("expense_id")
  WHERE "status" = 'ACTIVE' AND "type" = 'PERTANGGUNGJAWABAN' AND "expense_id" IS NOT NULL;

-- Nominal selalu positif; saldo negatif dijaga service di bawah kunci baris + cek ini per baris.
ALTER TABLE "fin_operational_advances" ADD CONSTRAINT "fin_operational_advances_amount_pos" CHECK ("amount" > 0);
ALTER TABLE "fin_operational_advances" ADD CONSTRAINT "fin_operational_advances_fee_nonneg" CHECK ("transfer_fee_amount" >= 0);
ALTER TABLE "fin_operational_advance_settlements" ADD CONSTRAINT "fin_adv_settlement_amount_pos" CHECK ("amount" > 0);
ALTER TABLE "fin_operational_advance_settlements" ADD CONSTRAINT "fin_adv_settlement_shape" CHECK (
  ("type" = 'PERTANGGUNGJAWABAN' AND "expense_id" IS NOT NULL AND "cash_account_id" IS NULL)
  OR ("type" = 'PENGEMBALIAN' AND "cash_account_id" IS NOT NULL AND "expense_id" IS NULL)
);
ALTER TABLE "fin_expenses" ADD CONSTRAINT "fin_expenses_advance_applied_range" CHECK ("advance_applied_amount" >= 0 AND "advance_applied_amount" <= "amount");

-- Akun sistem 1-1360 "Uang Muka Operasional" (aset lancar). Audit 24 Sep 2026: kode ini
-- belum dipakai di bagan akun bawaan maupun produksi. Tidak menimpa apa pun bila sudah ada.
INSERT INTO "fin_accounts" ("id", "code", "name", "type", "normal_balance", "parent_id", "is_postable", "cash_flow_category", "system_key", "active", "created_at", "updated_at")
SELECT gen_random_uuid(), '1-1360', 'Uang Muka Operasional', 'ASET', 'DEBIT',
       (SELECT "id" FROM "fin_accounts" WHERE "code" = '1-1000'), true, 'OPERASI', 'UANG_MUKA_OPERASIONAL', true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "fin_accounts" WHERE "code" = '1-1360' OR "system_key" = 'UANG_MUKA_OPERASIONAL');

-- Pengajuan LAMA yang memakai sumber "Uang muka operasional" (sebelum modul ini ada, dipetakan ke UTANG biasa):
-- TIDAK dimigrasikan otomatis. Hanya ditandai supaya ditinjau manusia. Idempoten; audit produksi 24 Sep 2026: 0 baris.
UPDATE "expense_submissions"
   SET "needs_review" = true,
       "review_note" = 'Dibuat sebelum modul Uang Muka Operasional: dicatat sebagai utang biasa. Tinjau apakah uangnya keluar dua kali.'
 WHERE "sumber_dana" = 'UANG_MUKA_OPERASIONAL' AND "advance_id" IS NULL AND "needs_review" = false;
