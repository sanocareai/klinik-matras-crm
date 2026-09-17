-- ═══════════════════════════════════════════════════════════════════════════
-- FINANCE WORKSPACE — FONDASI BUKU BESAR (D-180, 17 September 2026)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- MURNI ADITIF. Migration ini TIDAK menyentuh SATU PUN tabel yang sudah ada:
-- tidak ada ALTER TABLE, tidak ada DROP, tidak ada perubahan tipe kolom.
-- Seluruh relasi ke data lama (Order, Customer, Payment, goods_receipts,
-- "User") berupa kolom FK yang tinggal DI TABEL BARU — jadi seluruh fitur
-- yang berjalan hari ini (CRM, Produksi, Gudang, Delivery) nol risiko dari
-- migration ini, dan rollback-nya cukup DROP tabel-tabel fin_* ini.
--
-- TIDAK ADA BACKFILL DI SINI, DISENGAJA. Jurnal untuk transaksi historis
-- (228 order LUNAS lewat dropdown manual, payments, stock movements) TIDAK
-- dibuat otomatis oleh migration — lihat services/finance/backfill.js yang
-- dijalankan TERKENDALI oleh admin lewat UI setelah bagan akun & saldo awal
-- ditetapkan. Menjurnal 200+ transaksi lama di dalam migration berarti
-- mengarang tanggal & akun untuk uang yang detailnya tidak pernah dicatat.
--
-- CONSTRAINT CHECK di bagian bawah file ini adalah lapis KEDUA penegakan
-- (lapis pertama: services/finance/journal.js). Prisma tidak bisa
-- menyatakannya di schema.prisma, jadi ditulis langsung di sini — dan
-- justru itu yang membuat jurnal cacat mustahil masuk walau lewat psql
-- langsung, bukan cuma lewat aplikasi.

-- CreateEnum
CREATE TYPE "FinAccountType" AS ENUM ('ASET', 'KEWAJIBAN', 'EKUITAS', 'PENDAPATAN', 'BEBAN_POKOK', 'BEBAN');

-- CreateEnum
CREATE TYPE "FinNormalBalance" AS ENUM ('DEBIT', 'KREDIT');

-- CreateEnum
CREATE TYPE "FinCashFlowCategory" AS ENUM ('OPERASI', 'INVESTASI', 'PENDANAAN');

-- CreateEnum
CREATE TYPE "FinCashAccountKind" AS ENUM ('KAS', 'BANK', 'EWALLET');

-- CreateEnum
CREATE TYPE "FinPeriodStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "FinJournalStatus" AS ENUM ('DRAFT', 'POSTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "FinJournalSource" AS ENUM ('MANUAL', 'SALDO_AWAL', 'PEMBAYARAN_ORDER', 'PENGAKUAN_PENDAPATAN', 'REFUND', 'PENGELUARAN', 'BIAYA_KENDARAAN', 'BIAYA_IKLAN', 'PEMASUKAN_LAIN', 'TRANSFER_KAS', 'TAGIHAN_SUPPLIER', 'PEMBAYARAN_SUPPLIER', 'PEMAKAIAN_BAHAN', 'PENERIMAAN_BAHAN', 'REVERSAL');

-- CreateEnum
CREATE TYPE "FinDivision" AS ENUM ('SALES', 'PRODUKSI', 'GUDANG', 'DELIVERY', 'UMUM');

-- CreateEnum
CREATE TYPE "FinBillStatus" AS ENUM ('DRAFT', 'MENUNGGU_APPROVAL', 'DISETUJUI', 'DIBAYAR_SEBAGIAN', 'LUNAS', 'DITOLAK', 'DIBATALKAN');

-- CreateEnum
CREATE TYPE "FinRefundStatus" AS ENUM ('MENUNGGU_APPROVAL', 'DISETUJUI', 'DITOLAK', 'DIBATALKAN');

-- CreateEnum
CREATE TYPE "FinExpenseMode" AS ENUM ('LANGSUNG', 'REIMBURSEMENT', 'UTANG');

-- CreateEnum
CREATE TYPE "FinExpenseStatus" AS ENUM ('DRAFT', 'MENUNGGU_APPROVAL', 'DISETUJUI', 'DITOLAK', 'DIBAYAR', 'DIBATALKAN');

-- CreateEnum
CREATE TYPE "FinReconStatus" AS ENUM ('DRAFT', 'SELESAI');

-- CreateEnum
CREATE TYPE "FinBankLineStatus" AS ENUM ('BELUM_COCOK', 'COCOK', 'DIABAIKAN');

-- CreateTable
CREATE TABLE "fin_accounts" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "FinAccountType" NOT NULL,
    "normal_balance" "FinNormalBalance" NOT NULL,
    "parent_id" UUID,
    "is_postable" BOOLEAN NOT NULL DEFAULT true,
    "cash_flow_category" "FinCashFlowCategory",
    "system_key" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fin_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_cash_accounts" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "FinCashAccountKind" NOT NULL,
    "bank_name" TEXT,
    "account_number" TEXT,
    "account_holder" TEXT,
    "account_id" UUID NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fin_cash_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_periods" (
    "id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "status" "FinPeriodStatus" NOT NULL DEFAULT 'OPEN',
    "closed_at" TIMESTAMP(3),
    "closed_by" TEXT,
    "close_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_journal_entries" (
    "id" UUID NOT NULL,
    "entry_number" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "source" "FinJournalSource" NOT NULL,
    "source_id" TEXT,
    "idempotency_key" TEXT,
    "status" "FinJournalStatus" NOT NULL DEFAULT 'POSTED',
    "posted_at" TIMESTAMP(3),
    "posted_by" TEXT,
    "reversal_of_id" UUID,
    "reversed_at" TIMESTAMP(3),
    "reversal_reason" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fin_journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_journal_lines" (
    "id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "account_id" UUID NOT NULL,
    "debit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "description" TEXT,
    "order_id" TEXT,
    "customer_id" TEXT,
    "supplier_id" UUID,
    "cash_account_id" UUID,
    "unit_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_posting_gaps" (
    "id" UUID NOT NULL,
    "source" "FinJournalSource" NOT NULL,
    "source_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "resolved_at" TIMESTAMP(3),
    "resolved_entry_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_posting_gaps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fin_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "fin_expense_categories" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "account_id" UUID NOT NULL,
    "division" "FinDivision" NOT NULL DEFAULT 'UMUM',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "auto_map_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fin_expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_suppliers" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "payment_term_days" INTEGER,
    "bank_name" TEXT,
    "bank_account" TEXT,
    "bank_holder" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fin_suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_supplier_bills" (
    "id" UUID NOT NULL,
    "bill_number" TEXT NOT NULL,
    "supplier_ref" TEXT,
    "supplier_id" UUID NOT NULL,
    "bill_date" DATE NOT NULL,
    "due_date" DATE,
    "amount" DECIMAL(18,2) NOT NULL,
    "description" TEXT NOT NULL,
    "attachment_url" TEXT,
    "goods_receipt_id" UUID,
    "expense_category_id" UUID,
    "status" "FinBillStatus" NOT NULL DEFAULT 'DRAFT',
    "approved_at" TIMESTAMP(3),
    "approved_by" TEXT,
    "reject_reason" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fin_supplier_bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_supplier_payments" (
    "id" UUID NOT NULL,
    "payment_number" TEXT NOT NULL,
    "supplier_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "cash_account_id" UUID NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "attachment_url" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by" TEXT,
    "cancel_reason" TEXT,

    CONSTRAINT "fin_supplier_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_supplier_payment_allocations" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "bill_id" UUID NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_supplier_payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_payment_allocations" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "order_id" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "note" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_refunds" (
    "id" UUID NOT NULL,
    "refund_number" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "cash_account_id" UUID NOT NULL,
    "status" "FinRefundStatus" NOT NULL DEFAULT 'MENUNGGU_APPROVAL',
    "approved_at" TIMESTAMP(3),
    "approved_by" TEXT,
    "reject_reason" TEXT,
    "attachment_url" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fin_refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_expenses" (
    "id" UUID NOT NULL,
    "expense_number" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "description" TEXT NOT NULL,
    "category_id" UUID NOT NULL,
    "division" "FinDivision" NOT NULL DEFAULT 'UMUM',
    "mode" "FinExpenseMode" NOT NULL DEFAULT 'LANGSUNG',
    "cash_account_id" UUID,
    "supplier_id" UUID,
    "reimburse_to" TEXT,
    "payee_name" TEXT,
    "order_id" TEXT,
    "unit_id" TEXT,
    "receipt_url" TEXT,
    "notes" TEXT,
    "status" "FinExpenseStatus" NOT NULL DEFAULT 'DRAFT',
    "submitted_at" TIMESTAMP(3),
    "approved_at" TIMESTAMP(3),
    "approved_by" TEXT,
    "reject_reason" TEXT,
    "paid_at" TIMESTAMP(3),
    "paid_by" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fin_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_other_incomes" (
    "id" UUID NOT NULL,
    "income_number" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "description" TEXT NOT NULL,
    "account_id" UUID NOT NULL,
    "cash_account_id" UUID NOT NULL,
    "attachment_url" TEXT,
    "notes" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by" TEXT,
    "cancel_reason" TEXT,

    CONSTRAINT "fin_other_incomes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_cash_transfers" (
    "id" UUID NOT NULL,
    "transfer_number" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "from_account_id" UUID NOT NULL,
    "to_account_id" UUID NOT NULL,
    "fee_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "reference" TEXT,
    "notes" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by" TEXT,
    "cancel_reason" TEXT,

    CONSTRAINT "fin_cash_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_bank_statements" (
    "id" UUID NOT NULL,
    "cash_account_id" UUID NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "opening_balance" DECIMAL(18,2) NOT NULL,
    "closing_balance" DECIMAL(18,2) NOT NULL,
    "status" "FinReconStatus" NOT NULL DEFAULT 'DRAFT',
    "completed_at" TIMESTAMP(3),
    "completed_by" TEXT,
    "note" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fin_bank_statements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_bank_statement_lines" (
    "id" UUID NOT NULL,
    "statement_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "status" "FinBankLineStatus" NOT NULL DEFAULT 'BELUM_COCOK',
    "matched_line_id" UUID,
    "matched_at" TIMESTAMP(3),
    "matched_by" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_bank_statement_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fin_accounts_code_key" ON "fin_accounts"("code");

-- CreateIndex
CREATE UNIQUE INDEX "fin_accounts_system_key_key" ON "fin_accounts"("system_key");

-- CreateIndex
CREATE INDEX "fin_accounts_type_code_idx" ON "fin_accounts"("type", "code");

-- CreateIndex
CREATE INDEX "fin_accounts_active_idx" ON "fin_accounts"("active");

-- CreateIndex
CREATE INDEX "fin_cash_accounts_active_idx" ON "fin_cash_accounts"("active");

-- CreateIndex
CREATE INDEX "fin_periods_status_idx" ON "fin_periods"("status");

-- CreateIndex
CREATE UNIQUE INDEX "fin_periods_year_month_key" ON "fin_periods"("year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "fin_journal_entries_entry_number_key" ON "fin_journal_entries"("entry_number");

-- CreateIndex
CREATE UNIQUE INDEX "fin_journal_entries_idempotency_key_key" ON "fin_journal_entries"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "fin_journal_entries_reversal_of_id_key" ON "fin_journal_entries"("reversal_of_id");

-- CreateIndex
CREATE INDEX "fin_journal_entries_date_status_idx" ON "fin_journal_entries"("date", "status");

-- CreateIndex
CREATE INDEX "fin_journal_entries_source_source_id_idx" ON "fin_journal_entries"("source", "source_id");

-- CreateIndex
CREATE INDEX "fin_journal_entries_status_idx" ON "fin_journal_entries"("status");

-- CreateIndex
CREATE INDEX "fin_journal_lines_account_id_created_at_idx" ON "fin_journal_lines"("account_id", "created_at");

-- CreateIndex
CREATE INDEX "fin_journal_lines_entry_id_idx" ON "fin_journal_lines"("entry_id");

-- CreateIndex
CREATE INDEX "fin_journal_lines_order_id_idx" ON "fin_journal_lines"("order_id");

-- CreateIndex
CREATE INDEX "fin_journal_lines_customer_id_idx" ON "fin_journal_lines"("customer_id");

-- CreateIndex
CREATE INDEX "fin_journal_lines_supplier_id_idx" ON "fin_journal_lines"("supplier_id");

-- CreateIndex
CREATE INDEX "fin_journal_lines_cash_account_id_idx" ON "fin_journal_lines"("cash_account_id");

-- CreateIndex
CREATE INDEX "fin_posting_gaps_resolved_at_idx" ON "fin_posting_gaps"("resolved_at");

-- CreateIndex
CREATE UNIQUE INDEX "fin_posting_gaps_source_source_id_key" ON "fin_posting_gaps"("source", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "fin_expense_categories_code_key" ON "fin_expense_categories"("code");

-- CreateIndex
CREATE UNIQUE INDEX "fin_expense_categories_auto_map_key_key" ON "fin_expense_categories"("auto_map_key");

-- CreateIndex
CREATE INDEX "fin_expense_categories_active_idx" ON "fin_expense_categories"("active");

-- CreateIndex
CREATE UNIQUE INDEX "fin_suppliers_code_key" ON "fin_suppliers"("code");

-- CreateIndex
CREATE INDEX "fin_suppliers_active_idx" ON "fin_suppliers"("active");

-- CreateIndex
CREATE UNIQUE INDEX "fin_supplier_bills_bill_number_key" ON "fin_supplier_bills"("bill_number");

-- CreateIndex
CREATE INDEX "fin_supplier_bills_supplier_id_status_idx" ON "fin_supplier_bills"("supplier_id", "status");

-- CreateIndex
CREATE INDEX "fin_supplier_bills_due_date_idx" ON "fin_supplier_bills"("due_date");

-- CreateIndex
CREATE INDEX "fin_supplier_bills_status_idx" ON "fin_supplier_bills"("status");

-- CreateIndex
CREATE UNIQUE INDEX "fin_supplier_payments_payment_number_key" ON "fin_supplier_payments"("payment_number");

-- CreateIndex
CREATE INDEX "fin_supplier_payments_supplier_id_date_idx" ON "fin_supplier_payments"("supplier_id", "date");

-- CreateIndex
CREATE INDEX "fin_supplier_payment_allocations_bill_id_idx" ON "fin_supplier_payment_allocations"("bill_id");

-- CreateIndex
CREATE UNIQUE INDEX "fin_supplier_payment_allocations_payment_id_bill_id_key" ON "fin_supplier_payment_allocations"("payment_id", "bill_id");

-- CreateIndex
CREATE INDEX "fin_payment_allocations_order_id_idx" ON "fin_payment_allocations"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "fin_payment_allocations_payment_id_order_id_key" ON "fin_payment_allocations"("payment_id", "order_id");

-- CreateIndex
CREATE UNIQUE INDEX "fin_refunds_refund_number_key" ON "fin_refunds"("refund_number");

-- CreateIndex
CREATE INDEX "fin_refunds_order_id_idx" ON "fin_refunds"("order_id");

-- CreateIndex
CREATE INDEX "fin_refunds_status_idx" ON "fin_refunds"("status");

-- CreateIndex
CREATE UNIQUE INDEX "fin_expenses_expense_number_key" ON "fin_expenses"("expense_number");

-- CreateIndex
CREATE INDEX "fin_expenses_status_date_idx" ON "fin_expenses"("status", "date");

-- CreateIndex
CREATE INDEX "fin_expenses_category_id_date_idx" ON "fin_expenses"("category_id", "date");

-- CreateIndex
CREATE INDEX "fin_expenses_division_date_idx" ON "fin_expenses"("division", "date");

-- CreateIndex
CREATE INDEX "fin_expenses_reimburse_to_status_idx" ON "fin_expenses"("reimburse_to", "status");

-- CreateIndex
CREATE UNIQUE INDEX "fin_other_incomes_income_number_key" ON "fin_other_incomes"("income_number");

-- CreateIndex
CREATE INDEX "fin_other_incomes_date_idx" ON "fin_other_incomes"("date");

-- CreateIndex
CREATE UNIQUE INDEX "fin_cash_transfers_transfer_number_key" ON "fin_cash_transfers"("transfer_number");

-- CreateIndex
CREATE INDEX "fin_cash_transfers_date_idx" ON "fin_cash_transfers"("date");

-- CreateIndex
CREATE INDEX "fin_bank_statements_cash_account_id_period_start_idx" ON "fin_bank_statements"("cash_account_id", "period_start");

-- CreateIndex
CREATE INDEX "fin_bank_statement_lines_statement_id_status_idx" ON "fin_bank_statement_lines"("statement_id", "status");

-- CreateIndex
CREATE INDEX "fin_bank_statement_lines_matched_line_id_idx" ON "fin_bank_statement_lines"("matched_line_id");

-- AddForeignKey
ALTER TABLE "fin_accounts" ADD CONSTRAINT "fin_accounts_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "fin_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_cash_accounts" ADD CONSTRAINT "fin_cash_accounts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "fin_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_periods" ADD CONSTRAINT "fin_periods_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_journal_entries" ADD CONSTRAINT "fin_journal_entries_posted_by_fkey" FOREIGN KEY ("posted_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_journal_entries" ADD CONSTRAINT "fin_journal_entries_reversal_of_id_fkey" FOREIGN KEY ("reversal_of_id") REFERENCES "fin_journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_journal_entries" ADD CONSTRAINT "fin_journal_entries_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_journal_lines" ADD CONSTRAINT "fin_journal_lines_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "fin_journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_journal_lines" ADD CONSTRAINT "fin_journal_lines_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "fin_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_journal_lines" ADD CONSTRAINT "fin_journal_lines_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_journal_lines" ADD CONSTRAINT "fin_journal_lines_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_journal_lines" ADD CONSTRAINT "fin_journal_lines_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "fin_suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_journal_lines" ADD CONSTRAINT "fin_journal_lines_cash_account_id_fkey" FOREIGN KEY ("cash_account_id") REFERENCES "fin_cash_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_settings" ADD CONSTRAINT "fin_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_expense_categories" ADD CONSTRAINT "fin_expense_categories_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "fin_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_suppliers" ADD CONSTRAINT "fin_suppliers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_supplier_bills" ADD CONSTRAINT "fin_supplier_bills_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "fin_suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_supplier_bills" ADD CONSTRAINT "fin_supplier_bills_goods_receipt_id_fkey" FOREIGN KEY ("goods_receipt_id") REFERENCES "goods_receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_supplier_bills" ADD CONSTRAINT "fin_supplier_bills_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_supplier_bills" ADD CONSTRAINT "fin_supplier_bills_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_supplier_payments" ADD CONSTRAINT "fin_supplier_payments_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "fin_suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_supplier_payments" ADD CONSTRAINT "fin_supplier_payments_cash_account_id_fkey" FOREIGN KEY ("cash_account_id") REFERENCES "fin_cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_supplier_payments" ADD CONSTRAINT "fin_supplier_payments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_supplier_payments" ADD CONSTRAINT "fin_supplier_payments_cancelled_by_fkey" FOREIGN KEY ("cancelled_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_supplier_payment_allocations" ADD CONSTRAINT "fin_supplier_payment_allocations_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "fin_supplier_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_supplier_payment_allocations" ADD CONSTRAINT "fin_supplier_payment_allocations_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "fin_supplier_bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_payment_allocations" ADD CONSTRAINT "fin_payment_allocations_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_payment_allocations" ADD CONSTRAINT "fin_payment_allocations_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_payment_allocations" ADD CONSTRAINT "fin_payment_allocations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_refunds" ADD CONSTRAINT "fin_refunds_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_refunds" ADD CONSTRAINT "fin_refunds_cash_account_id_fkey" FOREIGN KEY ("cash_account_id") REFERENCES "fin_cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_refunds" ADD CONSTRAINT "fin_refunds_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_refunds" ADD CONSTRAINT "fin_refunds_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_expenses" ADD CONSTRAINT "fin_expenses_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "fin_expense_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_expenses" ADD CONSTRAINT "fin_expenses_cash_account_id_fkey" FOREIGN KEY ("cash_account_id") REFERENCES "fin_cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_expenses" ADD CONSTRAINT "fin_expenses_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "fin_suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_expenses" ADD CONSTRAINT "fin_expenses_reimburse_to_fkey" FOREIGN KEY ("reimburse_to") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_expenses" ADD CONSTRAINT "fin_expenses_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_expenses" ADD CONSTRAINT "fin_expenses_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_expenses" ADD CONSTRAINT "fin_expenses_paid_by_fkey" FOREIGN KEY ("paid_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_expenses" ADD CONSTRAINT "fin_expenses_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_other_incomes" ADD CONSTRAINT "fin_other_incomes_cash_account_id_fkey" FOREIGN KEY ("cash_account_id") REFERENCES "fin_cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_other_incomes" ADD CONSTRAINT "fin_other_incomes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_other_incomes" ADD CONSTRAINT "fin_other_incomes_cancelled_by_fkey" FOREIGN KEY ("cancelled_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_cash_transfers" ADD CONSTRAINT "fin_cash_transfers_from_account_id_fkey" FOREIGN KEY ("from_account_id") REFERENCES "fin_cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_cash_transfers" ADD CONSTRAINT "fin_cash_transfers_to_account_id_fkey" FOREIGN KEY ("to_account_id") REFERENCES "fin_cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_cash_transfers" ADD CONSTRAINT "fin_cash_transfers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_cash_transfers" ADD CONSTRAINT "fin_cash_transfers_cancelled_by_fkey" FOREIGN KEY ("cancelled_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_bank_statements" ADD CONSTRAINT "fin_bank_statements_cash_account_id_fkey" FOREIGN KEY ("cash_account_id") REFERENCES "fin_cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_bank_statements" ADD CONSTRAINT "fin_bank_statements_completed_by_fkey" FOREIGN KEY ("completed_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_bank_statements" ADD CONSTRAINT "fin_bank_statements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_bank_statement_lines" ADD CONSTRAINT "fin_bank_statement_lines_statement_id_fkey" FOREIGN KEY ("statement_id") REFERENCES "fin_bank_statements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_bank_statement_lines" ADD CONSTRAINT "fin_bank_statement_lines_matched_line_id_fkey" FOREIGN KEY ("matched_line_id") REFERENCES "fin_journal_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_bank_statement_lines" ADD CONSTRAINT "fin_bank_statement_lines_matched_by_fkey" FOREIGN KEY ("matched_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── PENEGAKAN INTEGRITAS AKUNTANSI (di luar jangkauan schema.prisma) ──────

-- Satu baris jurnal: debit & kredit tidak pernah negatif, dan TEPAT SATU
-- dari keduanya yang berisi nilai. Baris "debit 0 kredit 0" pun ditolak —
-- itu baris kosong yang cuma mengotori buku besar.
ALTER TABLE "fin_journal_lines"
  ADD CONSTRAINT "fin_journal_lines_amount_sign_check"
  CHECK ("debit" >= 0 AND "credit" >= 0 AND (("debit" > 0) <> ("credit" > 0)));

-- Nomor baris dalam satu jurnal tidak boleh dobel — urutan tampil jurnal
-- harus deterministik, dan baris kembar biasanya tanda posting dijalankan
-- dua kali lewat jalur yang lolos idempotencyKey.
CREATE UNIQUE INDEX "fin_journal_lines_entry_line_no_key"
  ON "fin_journal_lines" ("entry_id", "line_no");

-- Bulan periode akuntansi 1..12.
ALTER TABLE "fin_periods"
  ADD CONSTRAINT "fin_periods_month_range_check" CHECK ("month" BETWEEN 1 AND 12);

-- Nominal dokumen keuangan SELALU positif — arah uang ditentukan JENIS
-- dokumennya (pengeluaran/pemasukan/refund), tidak pernah oleh tanda minus.
-- Satu-satunya nominal bertanda di seluruh blok finance adalah
-- fin_bank_statement_lines.amount, yang memang transkrip koran bank apa
-- adanya (lihat komentar di schema.prisma).
ALTER TABLE "fin_expenses"
  ADD CONSTRAINT "fin_expenses_amount_positive_check" CHECK ("amount" > 0);
ALTER TABLE "fin_other_incomes"
  ADD CONSTRAINT "fin_other_incomes_amount_positive_check" CHECK ("amount" > 0);
ALTER TABLE "fin_supplier_bills"
  ADD CONSTRAINT "fin_supplier_bills_amount_positive_check" CHECK ("amount" > 0);
ALTER TABLE "fin_supplier_payments"
  ADD CONSTRAINT "fin_supplier_payments_amount_positive_check" CHECK ("amount" > 0);
ALTER TABLE "fin_supplier_payment_allocations"
  ADD CONSTRAINT "fin_supplier_payment_alloc_amount_positive_check" CHECK ("amount" > 0);
ALTER TABLE "fin_payment_allocations"
  ADD CONSTRAINT "fin_payment_allocations_amount_positive_check" CHECK ("amount" > 0);
ALTER TABLE "fin_refunds"
  ADD CONSTRAINT "fin_refunds_amount_positive_check" CHECK ("amount" > 0);
ALTER TABLE "fin_cash_transfers"
  ADD CONSTRAINT "fin_cash_transfers_amount_positive_check"
  CHECK ("amount" > 0 AND "fee_amount" >= 0);

-- Transfer antar rekening SENDIRI ke rekening yang sama = tidak ada
-- transaksi apa pun. Salah pilih dropdown yang gampang terjadi, dan
-- jurnalnya akan "seimbang" (debit & kredit ke akun yang sama) sehingga
-- lolos semua pengecekan lain — harus dihentikan di sini.
ALTER TABLE "fin_cash_transfers"
  ADD CONSTRAINT "fin_cash_transfers_distinct_accounts_check"
  CHECK ("from_account_id" <> "to_account_id");

-- Periode koran bank: akhir tidak boleh mendahului awal.
ALTER TABLE "fin_bank_statements"
  ADD CONSTRAINT "fin_bank_statements_period_order_check"
  CHECK ("period_end" >= "period_start");
