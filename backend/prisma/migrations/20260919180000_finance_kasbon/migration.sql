-- Modul Kasbon (uang muka gaji karyawan) — additive, tidak menyentuh data lama.
CREATE TYPE "FinKasbonStatus" AS ENUM ('AKTIF', 'LUNAS', 'DIBATALKAN');
CREATE TYPE "FinKasbonRepayMethod" AS ENUM ('POTONG_GAJI', 'TUNAI');

CREATE TABLE "fin_kasbon" (
  "id" UUID NOT NULL,
  "kasbon_number" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "employee_name" TEXT NOT NULL,
  "employee_id" TEXT,
  "urgency" TEXT,
  "notes" TEXT,
  "cash_account_id" UUID,
  "receipt_url" TEXT,
  "status" "FinKasbonStatus" NOT NULL DEFAULT 'AKTIF',
  "historis" BOOLEAN NOT NULL DEFAULT false,
  "journal_ref" TEXT,
  "cancelled_at" TIMESTAMP(3),
  "cancel_reason" TEXT,
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "fin_kasbon_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "fin_kasbon_repayments" (
  "id" UUID NOT NULL,
  "kasbon_id" UUID NOT NULL,
  "date" DATE NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "method" "FinKasbonRepayMethod" NOT NULL,
  "cash_account_id" UUID,
  "notes" TEXT,
  "cancelled_at" TIMESTAMP(3),
  "cancel_reason" TEXT,
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fin_kasbon_repayments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fin_kasbon_kasbon_number_key" ON "fin_kasbon"("kasbon_number");
CREATE INDEX "fin_kasbon_status_date_idx" ON "fin_kasbon"("status", "date");
CREATE INDEX "fin_kasbon_employee_name_status_idx" ON "fin_kasbon"("employee_name", "status");
CREATE INDEX "fin_kasbon_repayments_kasbon_id_idx" ON "fin_kasbon_repayments"("kasbon_id");

ALTER TABLE "fin_kasbon" ADD CONSTRAINT "fin_kasbon_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "fin_kasbon" ADD CONSTRAINT "fin_kasbon_cash_account_id_fkey" FOREIGN KEY ("cash_account_id") REFERENCES "fin_cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fin_kasbon" ADD CONSTRAINT "fin_kasbon_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "fin_kasbon_repayments" ADD CONSTRAINT "fin_kasbon_repayments_kasbon_id_fkey" FOREIGN KEY ("kasbon_id") REFERENCES "fin_kasbon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fin_kasbon_repayments" ADD CONSTRAINT "fin_kasbon_repayments_cash_account_id_fkey" FOREIGN KEY ("cash_account_id") REFERENCES "fin_cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fin_kasbon_repayments" ADD CONSTRAINT "fin_kasbon_repayments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
