-- Katalog harga jual SALES (29 Agustus 2026), dari "Daftar Harga Klinik
-- Matras Sano per 5 Jul 2026". TERPISAH dari service_catalog (katalog
-- PRODUKSI, routing modul kerja, tanpa harga) — ditautkan lewat kolom
-- opsional production_service_id. Lihat catatan panjang di schema.prisma.

CREATE TYPE "PriceItemKind" AS ENUM ('SERVICE', 'ADDON', 'PRODUCT', 'RENTAL', 'FEE');

-- Baris daftar harga (layanan / produk / biaya).
CREATE TABLE "price_items" (
    "id"                    TEXT NOT NULL,
    "code"                  TEXT NOT NULL,
    "name"                  TEXT NOT NULL,
    "productLine"           "ProductLine" NOT NULL,
    "kind"                  "PriceItemKind" NOT NULL,
    -- informasional saja, TIDAK pernah dipakai menghitung harga
    "discount_percent"      DECIMAL(5,2),
    "production_service_id" UUID,
    "active"                BOOLEAN NOT NULL DEFAULT true,
    "sort_order"            INTEGER NOT NULL DEFAULT 0,
    "note"                  TEXT,
    "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"            TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "price_items_code_key" ON "price_items"("code");
CREATE INDEX "price_items_productLine_kind_active_idx" ON "price_items"("productLine", "kind", "active");

-- SetNull, bukan Cascade: menghapus baris katalog PRODUKSI tidak boleh ikut
-- menghapus baris harga SALES — dua katalog yang independen.
ALTER TABLE "price_items" ADD CONSTRAINT "price_items_production_service_id_fkey"
    FOREIGN KEY ("production_service_id") REFERENCES "service_catalog"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Satu sel matriks: (layanan x varian) -> harga normal + standard.
-- Kedua harga nullable: banyak baris hanya punya kolom STANDARD terisi,
-- dan ada sel yang memang kosong/"X" di sumbernya. NULL = belum ditetapkan.
CREATE TABLE "price_rates" (
    "id"             TEXT NOT NULL,
    "price_item_id"  TEXT NOT NULL,
    "variant_key"    TEXT NOT NULL,
    "normal_price"   INTEGER,
    "standard_price" INTEGER,

    CONSTRAINT "price_rates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "price_rates_price_item_id_variant_key_key" ON "price_rates"("price_item_id", "variant_key");

ALTER TABLE "price_rates" ADD CONSTRAINT "price_rates_price_item_id_fkey"
    FOREIGN KEY ("price_item_id") REFERENCES "price_items"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Tautan + snapshot harga di baris order. SEMUA nullable: 352 baris order
-- lama tidak punya tautan katalog, dan isian bebas di luar katalog tetap
-- diizinkan. layananName & harga TIDAK disentuh — arti keduanya tidak
-- berubah, 8 pembaca yang sudah ada tetap jalan tanpa perubahan.
ALTER TABLE "OrderItem" ADD COLUMN "price_item_id"  TEXT;
ALTER TABLE "OrderItem" ADD COLUMN "variant_key"    TEXT;
ALTER TABLE "OrderItem" ADD COLUMN "normal_price"   INTEGER;
ALTER TABLE "OrderItem" ADD COLUMN "standard_price" INTEGER;

CREATE INDEX "OrderItem_price_item_id_idx" ON "OrderItem"("price_item_id");

ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_price_item_id_fkey"
    FOREIGN KEY ("price_item_id") REFERENCES "price_items"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
