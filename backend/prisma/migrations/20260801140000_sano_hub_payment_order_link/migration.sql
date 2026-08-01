-- Sano Hub Phase 4 — Payment terikat ke Order (D-023), bukan cuma Job.
-- NOT NULL langsung (bukan backfill) karena tabel payments masih 0 baris
-- di production saat migrasi ini ditulis (fitur D-011 baru live, belum
-- ada driver yang mencatat pembayaran nyata) — diverifikasi lewat
-- SELECT COUNT(*) FROM payments sebelum menulis migrasi ini.

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "order_id" TEXT NOT NULL,
ALTER COLUMN "job_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "payments_order_id_idx" ON "payments"("order_id");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
