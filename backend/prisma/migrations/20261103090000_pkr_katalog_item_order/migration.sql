-- PENJUALAN KARYAWAN — ORDER MULTI-ITEM (Okt 2026). MIGRASI ADITIF: hanya tabel BARU + data awal katalog. Tabel/kolom lama TIDAK diubah, tidak ada backfill.
--   pkr_item_categories : kategori item produksi yang dikelola Admin (bentuk isian + jenis pekerjaan)
--   pkr_item_products   : produk/varian per kategori (opsional tautan ke layanan produksi)
--   pkr_order_items     : item produksi pada order PKR (SATU PKR -> satu Order -> banyak item)
--   pkr_order_item_units: tautan item -> unit produksi yang dilahirkan (satu unit milik tepat satu item)
-- Order PKR lama (tanpa baris pkr_order_items) tetap terbaca: layar membentuk item virtual dari kategori/merk/ukuran/jumlah unit yang sudah ada.
-- Nominal/pembayaran/invoice/jurnal TIDAK disentuh: tabel ini tidak memuat uang dan tidak berelasi dengan OrderItem (yang dilarang trigger pada order PKR).

-- CreateTable
CREATE TABLE "pkr_item_categories" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "shape" VARCHAR(20) NOT NULL,
    "work_kind" VARCHAR(10) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pkr_item_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pkr_item_products" (
    "id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "production_service_id" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pkr_item_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pkr_order_items" (
    "id" UUID NOT NULL,
    "penjualan_id" UUID NOT NULL,
    "order_id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "category_id" UUID NOT NULL,
    "product_id" UUID,
    "category_code" VARCHAR(40) NOT NULL,
    "category_name" VARCHAR(100) NOT NULL,
    "shape" VARCHAR(20) NOT NULL,
    "work_kind" VARCHAR(10) NOT NULL,
    "product_name" VARCHAR(160),
    "qty" INTEGER NOT NULL,
    "length_cm" DECIMAL(7,1),
    "width_cm" DECIMAL(7,1),
    "thickness_cm" DECIMAL(7,1),
    "height_cm" DECIMAL(7,1),
    "spec_notes" VARCHAR(1000),
    "perlu_dikirim" BOOLEAN,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pkr_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pkr_order_item_units" (
    "id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pkr_order_item_units_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pkr_item_categories_code_key" ON "pkr_item_categories"("code");

-- CreateIndex
CREATE INDEX "pkr_item_categories_active_sort_order_idx" ON "pkr_item_categories"("active", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "pkr_item_products_code_key" ON "pkr_item_products"("code");

-- CreateIndex
CREATE INDEX "pkr_item_products_category_id_active_sort_order_idx" ON "pkr_item_products"("category_id", "active", "sort_order");

-- CreateIndex
CREATE INDEX "pkr_order_items_penjualan_id_idx" ON "pkr_order_items"("penjualan_id");

-- CreateIndex
CREATE UNIQUE INDEX "pkr_order_items_order_id_seq_key" ON "pkr_order_items"("order_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "pkr_order_item_units_unit_id_key" ON "pkr_order_item_units"("unit_id");

-- CreateIndex
CREATE INDEX "pkr_order_item_units_item_id_idx" ON "pkr_order_item_units"("item_id");

-- AddForeignKey
ALTER TABLE "pkr_item_products" ADD CONSTRAINT "pkr_item_products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "pkr_item_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pkr_item_products" ADD CONSTRAINT "pkr_item_products_production_service_id_fkey" FOREIGN KEY ("production_service_id") REFERENCES "service_catalog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pkr_order_items" ADD CONSTRAINT "pkr_order_items_penjualan_id_fkey" FOREIGN KEY ("penjualan_id") REFERENCES "fin_penjualan_karyawan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pkr_order_items" ADD CONSTRAINT "pkr_order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pkr_order_items" ADD CONSTRAINT "pkr_order_items_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "pkr_item_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pkr_order_items" ADD CONSTRAINT "pkr_order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "pkr_item_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pkr_order_item_units" ADD CONSTRAINT "pkr_order_item_units_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "pkr_order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pkr_order_item_units" ADD CONSTRAINT "pkr_order_item_units_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK constraints (nilai yang dijaga basis data; aturan bisnis lengkap ada di aplikasi)
ALTER TABLE "pkr_item_categories" ADD CONSTRAINT "pkr_item_categories_shape_chk" CHECK ("shape" IN ('KASUR', 'SERVICE', 'DIVAN', 'SANDARAN', 'SET', 'CUSTOM'));
ALTER TABLE "pkr_item_categories" ADD CONSTRAINT "pkr_item_categories_work_kind_chk" CHECK ("work_kind" IN ('BARU', 'LAYANAN'));
ALTER TABLE "pkr_order_items" ADD CONSTRAINT "pkr_order_items_shape_chk" CHECK ("shape" IN ('KASUR', 'SERVICE', 'DIVAN', 'SANDARAN', 'SET', 'CUSTOM'));
ALTER TABLE "pkr_order_items" ADD CONSTRAINT "pkr_order_items_work_kind_chk" CHECK ("work_kind" IN ('BARU', 'LAYANAN'));
ALTER TABLE "pkr_order_items" ADD CONSTRAINT "pkr_order_items_qty_chk" CHECK ("qty" >= 1 AND "qty" <= 20);
ALTER TABLE "pkr_order_items" ADD CONSTRAINT "pkr_order_items_dim_chk" CHECK (
  ("length_cm" IS NULL OR "length_cm" > 0) AND ("width_cm" IS NULL OR "width_cm" > 0) AND ("thickness_cm" IS NULL OR "thickness_cm" > 0) AND ("height_cm" IS NULL OR "height_cm" > 0)
);

-- DATA AWAL katalog (Kasur Baru, Service/Upgrade Kasur, Divan/Box, Sandaran/Headboard, Set Kasur Lengkap, Produk Custom Lainnya). Admin dapat menambah/menonaktifkan; kode tetap.
INSERT INTO "pkr_item_categories" ("id", "code", "name", "shape", "work_kind", "sort_order", "updated_at") VALUES
  (gen_random_uuid(), 'KASUR_BARU',      'Kasur Baru',            'KASUR',    'BARU',    10, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'SERVICE_UPGRADE', 'Service/Upgrade Kasur', 'SERVICE',  'LAYANAN', 20, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'DIVAN_BOX',       'Divan/Box',             'DIVAN',    'BARU',    30, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'SANDARAN',        'Sandaran/Headboard',    'SANDARAN', 'BARU',    40, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'SET_LENGKAP',     'Set Kasur Lengkap',     'SET',      'BARU',    50, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'CUSTOM_LAINNYA',  'Produk Custom Lainnya', 'CUSTOM',   'BARU',    60, CURRENT_TIMESTAMP);

-- Produk awal diambil dari katalog yang SUDAH ada (nama produk di daftar harga Sales dan layanan produksi): hanya nama, TANPA harga dan TANPA tautan layanan produksi
-- (pemetaan ke layanan produksi adalah keputusan Admin). Bila katalog sumber kosong (database baru) tidak ada produk awal; Admin menambahkannya.
INSERT INTO "pkr_item_products" ("id", "category_id", "code", "name", "sort_order", "updated_at")
SELECT gen_random_uuid(), c."id", 'PRD:' || p."code", p."name", p."sort_order", CURRENT_TIMESTAMP
FROM "price_items" p JOIN "pkr_item_categories" c ON c."code" = 'KASUR_BARU'
WHERE p."kind" = 'PRODUCT' AND p."productLine" = 'KASUR' AND (p."code" LIKE 'PRD_MS_CUSTOM%' OR p."code" = 'PRD_KASUR_2IN1');

INSERT INTO "pkr_item_products" ("id", "category_id", "code", "name", "sort_order", "updated_at")
SELECT gen_random_uuid(), c."id", 'PRD:' || p."code", p."name", p."sort_order", CURRENT_TIMESTAMP
FROM "price_items" p JOIN "pkr_item_categories" c ON c."code" = 'DIVAN_BOX'
WHERE p."kind" = 'PRODUCT' AND p."code" = 'PRD_DIVAN';

INSERT INTO "pkr_item_products" ("id", "category_id", "code", "name", "sort_order", "updated_at")
SELECT gen_random_uuid(), c."id", 'PRD:' || p."code", p."name", p."sort_order", CURRENT_TIMESTAMP
FROM "price_items" p JOIN "pkr_item_categories" c ON c."code" = 'SANDARAN'
WHERE p."kind" = 'PRODUCT' AND p."code" = 'PRD_SANDARAN';

INSERT INTO "pkr_item_products" ("id", "category_id", "code", "name", "sort_order", "updated_at")
SELECT gen_random_uuid(), c."id", 'SVC:' || s."code", s."label_id", s."sort_order", CURRENT_TIMESTAMP
FROM "service_catalog" s JOIN "pkr_item_categories" c ON c."code" = 'SERVICE_UPGRADE';
