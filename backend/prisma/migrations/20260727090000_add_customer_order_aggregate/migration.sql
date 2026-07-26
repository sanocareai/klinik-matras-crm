-- Kolom denormalized orderCount/orderValue di Customer — lihat komentar
-- panjang di schema.prisma. Backfill LANGSUNG di migration ini (bukan script
-- terpisah) karena costnya kecil (1 UPDATE ber-JOIN, bukan N+1) dan supaya
-- kolom baru TIDAK PERNAH ada dalam keadaan "0 padahal sebenarnya ada order"
-- di production — GET /customers versi baru langsung filter/sort dari kolom
-- ini begitu migration selesai, jadi tidak boleh ada jendela waktu kosong.

ALTER TABLE "Customer" ADD COLUMN "orderCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Customer" ADD COLUMN "orderValue" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "Customer_orderValue_idx" ON "Customer"("orderValue");
CREATE INDEX "Customer_orderCount_idx" ON "Customer"("orderCount");

-- Backfill dari data Order yang sudah ada — CANCELLED dikecualikan, sama
-- persis dengan definisi yang sudah dipakai di seluruh aplikasi lain.
UPDATE "Customer" c SET
  "orderCount" = agg.cnt,
  "orderValue" = agg.val
FROM (
  SELECT "customerId", COUNT(*)::int AS cnt, COALESCE(SUM(value), 0)::int AS val
  FROM "Order"
  WHERE status <> 'CANCELLED'
  GROUP BY "customerId"
) agg
WHERE c.id = agg."customerId";
