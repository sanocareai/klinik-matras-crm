-- Tab Pembelian (Finance): FinPurchase + FinPurchaseCategory, sumber jurnal PEMBELIAN.
-- Murni aditif. Kategori bawaan, systemKey 1-1500, dan penonaktifan kategori
-- pengeluaran BAHAN_BAKU_MANUAL dipasang lewat ensureDefaultChartOfAccounts
-- (tombol "Pasang Akun Bawaan"), bukan di sini.

-- AlterEnum
ALTER TYPE "FinJournalSource" ADD VALUE 'PEMBELIAN';

-- CreateTable
CREATE TABLE "fin_purchase_categories" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "account_id" UUID NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fin_purchase_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_purchases" (
    "id" UUID NOT NULL,
    "purchase_number" TEXT NOT NULL,
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

    CONSTRAINT "fin_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fin_purchase_categories_code_key" ON "fin_purchase_categories"("code");

-- CreateIndex
CREATE INDEX "fin_purchase_categories_active_idx" ON "fin_purchase_categories"("active");

-- CreateIndex
CREATE UNIQUE INDEX "fin_purchases_purchase_number_key" ON "fin_purchases"("purchase_number");

-- CreateIndex
CREATE INDEX "fin_purchases_status_date_idx" ON "fin_purchases"("status", "date");

-- CreateIndex
CREATE INDEX "fin_purchases_category_id_date_idx" ON "fin_purchases"("category_id", "date");

-- CreateIndex
CREATE INDEX "fin_purchases_division_date_idx" ON "fin_purchases"("division", "date");

-- CreateIndex
CREATE INDEX "fin_purchases_reimburse_to_status_idx" ON "fin_purchases"("reimburse_to", "status");

-- AddForeignKey
ALTER TABLE "fin_purchase_categories" ADD CONSTRAINT "fin_purchase_categories_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "fin_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_purchases" ADD CONSTRAINT "fin_purchases_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "fin_purchase_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_purchases" ADD CONSTRAINT "fin_purchases_cash_account_id_fkey" FOREIGN KEY ("cash_account_id") REFERENCES "fin_cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_purchases" ADD CONSTRAINT "fin_purchases_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "fin_suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_purchases" ADD CONSTRAINT "fin_purchases_reimburse_to_fkey" FOREIGN KEY ("reimburse_to") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_purchases" ADD CONSTRAINT "fin_purchases_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_purchases" ADD CONSTRAINT "fin_purchases_paid_by_fkey" FOREIGN KEY ("paid_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_purchases" ADD CONSTRAINT "fin_purchases_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

