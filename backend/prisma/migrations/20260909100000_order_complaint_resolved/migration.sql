-- Penyelesaian komplain (9 September 2026, D-109) — lihat komentar panjang
-- di schema.prisma. Murni aditif, tidak ada data yang berubah/dihapus.
ALTER TABLE "Order" ADD COLUMN "complaint_resolved_at" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "complaint_resolved_by" TEXT;

ALTER TABLE "Order" ADD CONSTRAINT "Order_complaint_resolved_by_fkey"
  FOREIGN KEY ("complaint_resolved_by") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
