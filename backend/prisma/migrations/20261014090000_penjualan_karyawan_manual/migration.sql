-- CreateEnum
CREATE TYPE "FinPenjualanKaryawanStatus" AS ENUM ('AKTIF', 'DIBATALKAN');

-- CreateEnum
CREATE TYPE "FinPenjualanKaryawanMetode" AS ENUM ('TUNAI', 'TRANSFER', 'POTONG_GAJI');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "FinJournalSource" ADD VALUE 'PENJUALAN_KARYAWAN';
ALTER TYPE "FinJournalSource" ADD VALUE 'PEMBAYARAN_PENJUALAN_KARYAWAN';

-- CreateTable
CREATE TABLE "fin_penjualan_karyawan" (
    "id" UUID NOT NULL,
    "nomor" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "seller_id" TEXT NOT NULL,
    "buyer_name" TEXT NOT NULL,
    "notes" TEXT,
    "total" DECIMAL(18,2) NOT NULL,
    "status" "FinPenjualanKaryawanStatus" NOT NULL DEFAULT 'AKTIF',
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fin_penjualan_karyawan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_penjualan_karyawan_items" (
    "id" UUID NOT NULL,
    "penjualan_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(18,2) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "fin_penjualan_karyawan_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_penjualan_karyawan_payments" (
    "id" UUID NOT NULL,
    "penjualan_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "method" "FinPenjualanKaryawanMetode" NOT NULL,
    "cash_account_id" UUID,
    "receipt_url" TEXT,
    "notes" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_penjualan_karyawan_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fin_penjualan_karyawan_nomor_key" ON "fin_penjualan_karyawan"("nomor");

-- CreateIndex
CREATE INDEX "fin_penjualan_karyawan_seller_id_status_idx" ON "fin_penjualan_karyawan"("seller_id", "status");

-- CreateIndex
CREATE INDEX "fin_penjualan_karyawan_date_idx" ON "fin_penjualan_karyawan"("date");

-- CreateIndex
CREATE INDEX "fin_penjualan_karyawan_items_penjualan_id_idx" ON "fin_penjualan_karyawan_items"("penjualan_id");

-- CreateIndex
CREATE INDEX "fin_penjualan_karyawan_payments_penjualan_id_idx" ON "fin_penjualan_karyawan_payments"("penjualan_id");

-- AddForeignKey
ALTER TABLE "fin_penjualan_karyawan" ADD CONSTRAINT "fin_penjualan_karyawan_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_penjualan_karyawan" ADD CONSTRAINT "fin_penjualan_karyawan_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_penjualan_karyawan_items" ADD CONSTRAINT "fin_penjualan_karyawan_items_penjualan_id_fkey" FOREIGN KEY ("penjualan_id") REFERENCES "fin_penjualan_karyawan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_penjualan_karyawan_payments" ADD CONSTRAINT "fin_penjualan_karyawan_payments_penjualan_id_fkey" FOREIGN KEY ("penjualan_id") REFERENCES "fin_penjualan_karyawan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_penjualan_karyawan_payments" ADD CONSTRAINT "fin_penjualan_karyawan_payments_cash_account_id_fkey" FOREIGN KEY ("cash_account_id") REFERENCES "fin_cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_penjualan_karyawan_payments" ADD CONSTRAINT "fin_penjualan_karyawan_payments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

