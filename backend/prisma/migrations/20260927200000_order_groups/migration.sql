-- Resi Gabungan Fase 2 — MURNI ADITIF: satu enum + satu tabel baru + satu kolom nullable di "Order".
-- Tidak ada UPDATE/DELETE pada data lama, tidak ada backfill di sini (backfill = skrip terpisah, metadata-only, dijalankan manual).
-- Order lama: group_id = NULL, perilakunya identik. Tidak menyentuh Payment, jurnal, Invoice, Unit, Job.
CREATE TYPE "OrderGroupSource" AS ENUM ('BARU', 'BACKFILL_BUNDLE');

CREATE TABLE "order_groups" (
    "id"              TEXT               NOT NULL,
    "customer_id"     TEXT               NOT NULL,
    "source"          "OrderGroupSource" NOT NULL,
    "anchor_order_id" TEXT,
    "alamat_kirim"    TEXT,
    "kota_kirim"      TEXT,
    "tautan_lokasi"   TEXT,
    "tanggal_kirim"   DATE,
    "ongkir_tambahan" INTEGER,
    "dp_persen"       INTEGER,
    "dp_target"       INTEGER,
    "metadata"        JSONB,
    "created_by"      TEXT,
    "created_at"      TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMP(3)       NOT NULL,

    CONSTRAINT "order_groups_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Order" ADD COLUMN "group_id" TEXT;

CREATE UNIQUE INDEX "order_groups_anchor_order_id_key" ON "order_groups"("anchor_order_id");
CREATE INDEX "order_groups_customer_id_idx" ON "order_groups"("customer_id");
CREATE INDEX "order_groups_source_idx" ON "order_groups"("source");
CREATE INDEX "Order_group_id_idx" ON "Order"("group_id");

ALTER TABLE "order_groups" ADD CONSTRAINT "order_groups_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_groups" ADD CONSTRAINT "order_groups_anchor_order_id_fkey" FOREIGN KEY ("anchor_order_id") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "order_groups" ADD CONSTRAINT "order_groups_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "order_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
