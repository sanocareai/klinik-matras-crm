-- D-026: tracking kampanye promo per order (mis. "Merdeka dari Sakit
-- Pinggang" diskon hingga 17%). Lihat catatan panjang di schema.prisma di
-- atas model Order.promoId dan model Promo.

CREATE TABLE "promos" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "discountPercent" INTEGER,
    "validFrom" DATE,
    "validUntil" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promos_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "promos_code_key" ON "promos"("code");
CREATE INDEX "promos_active_idx" ON "promos"("active");

ALTER TABLE "promos" ADD CONSTRAINT "promos_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Order" ADD COLUMN "promo_id" TEXT;
CREATE INDEX "Order_promo_id_idx" ON "Order"("promo_id");

ALTER TABLE "Order" ADD CONSTRAINT "Order_promo_id_fkey"
    FOREIGN KEY ("promo_id") REFERENCES "promos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
