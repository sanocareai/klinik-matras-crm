-- DP disepakati (Order.dpTarget) + pembatalan entri pembayaran (Payment.cancelledAt
-- dkk) — 2 September 2026. Lihat komentar panjang di schema.prisma untuk alasan
-- desain (dpTarget murni pembanding UI, tidak menyentuh paymentStatus/paidAt;
-- pembatalan TIDAK menghapus baris, cuma menandainya keluar dari SUM(payments)).

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "dp_target" INTEGER;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN "cancelled_at" TIMESTAMP(3),
                        ADD COLUMN "cancelled_by" TEXT,
                        ADD COLUMN "cancel_reason" TEXT;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_cancelled_by_fkey"
  FOREIGN KEY ("cancelled_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
