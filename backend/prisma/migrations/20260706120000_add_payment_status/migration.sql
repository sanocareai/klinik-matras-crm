-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('BELUM_BAYAR', 'DP', 'LUNAS');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'BELUM_BAYAR';
