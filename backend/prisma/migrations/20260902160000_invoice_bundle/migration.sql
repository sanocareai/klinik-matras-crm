-- Gabung invoice lintas-order (2 Sep 2026) — self-reference tambahan di
-- Invoice, TIDAK mengubah relasi orderId yang sudah ada. Lihat komentar
-- panjang di schema.prisma untuk alasan desain.

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN "combined_into_id" TEXT;

-- CreateIndex
CREATE INDEX "invoices_combined_into_id_idx" ON "invoices"("combined_into_id");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_combined_into_id_fkey"
  FOREIGN KEY ("combined_into_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
