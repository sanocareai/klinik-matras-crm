-- PENJUALAN KARYAWAN — ORDER CAMPURAN, BUNDEL SET, PEMETAAN RUTE PRODUKSI, KOREKSI ITEM, PENGIRIMAN SEBAGIAN (Okt 2026).
-- MIGRASI ADITIF: kolom NULLABLE + tabel baru + data awal literal. Tidak ada baris lama yang diubah/dihapus, tidak ada backfill berisiko.
--
--   units.work_category/product_line/product_type : kategori & rute EFEKTIF per unit. NULL = ikut Order (perilaku lama PERSIS; semua unit yang sudah ada tetap NULL).
--                                                   Terisi hanya untuk unit yang dilahirkan item PKR, supaya order CAMPURAN (kasur + divan + service) tiap unitnya
--                                                   dirutekan menurut itemnya sendiri, bukan menurut satu kategori/jenis di tingkat order.
--   pkr_item_categories/products.product_line/product_type/production_service_id : PEMETAAN rute Produksi (kelompok produk -> alur) yang dikelola Admin.
--   pkr_bundle_components : komposisi bundel katalog (mis. Set Kasur Lengkap = Kasur + Divan + Sandaran) yang dipecah menjadi komponen operasional.
--   pkr_order_items.bundle_* / removed_* : asal bundel + penghapusan lunak (item dikoreksi tidak pernah dihapus fisik; riwayat tetap utuh).
--   pkr_item_revisions   : buku besar REVISI himpunan item per order (append-only). Revisi terakhir = token konkurensi optimistis; satu baris per perubahan.
--   pkr_pengiriman_sebagian : catatan aksi eksplisit "kirim sebagian" (unit dipilih, alasan, pelaku, kunci idempotensi).

-- ── units ───────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE "units" ADD COLUMN "work_category" "OrderCategory";
ALTER TABLE "units" ADD COLUMN "product_line" "ProductLine";
ALTER TABLE "units" ADD COLUMN "product_type" "ProductType";
ALTER TABLE "units" ADD CONSTRAINT "units_work_category_chk" CHECK ("work_category" IS NULL OR "work_category" IN ('BARU', 'LAYANAN'));

-- ── pemetaan rute Produksi di katalog ────────────────────────────────────────────────────────────────
ALTER TABLE "pkr_item_categories" ADD COLUMN "product_line" "ProductLine";
ALTER TABLE "pkr_item_categories" ADD COLUMN "product_type" "ProductType";
ALTER TABLE "pkr_item_categories" ADD COLUMN "production_service_id" UUID;
ALTER TABLE "pkr_item_categories" ADD CONSTRAINT "pkr_item_categories_production_service_id_fkey" FOREIGN KEY ("production_service_id") REFERENCES "service_catalog"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pkr_item_products" ADD COLUMN "product_line" "ProductLine";
ALTER TABLE "pkr_item_products" ADD COLUMN "product_type" "ProductType";

-- Pemetaan awal HANYA yang literal (nama jenis produk = nama kategorinya, atau produk memang diturunkan 1:1 dari satu layanan). Yang lain SENGAJA dibiarkan kosong:
-- memilih jenis kasur (Kasur Sehat/Spring/Busa/…) adalah keputusan Admin, dan order dengan produk tanpa pemetaan DIBLOKIR saat pratinjau/pembuatan sampai Admin memetakannya.
UPDATE "pkr_item_categories" SET "product_line" = 'DIVAN', "product_type" = 'DIVAN_UTAMA'    WHERE "code" = 'DIVAN_BOX';
UPDATE "pkr_item_categories" SET "product_line" = 'DIVAN', "product_type" = 'DIVAN_SANDARAN' WHERE "code" = 'SANDARAN';
UPDATE "pkr_item_categories" SET "product_line" = 'KASUR' WHERE "code" IN ('KASUR_BARU', 'SERVICE_UPGRADE');
UPDATE "pkr_item_products"   SET "product_line" = 'KASUR', "product_type" = 'KASUR_2IN1' WHERE "code" = 'PRD:PRD_KASUR_2IN1';
-- Produk service/upgrade diturunkan langsung dari service_catalog (kode 'SVC:<kode layanan>'): tautannya ke layanan yang sama adalah penurunan, bukan tebakan.
UPDATE "pkr_item_products" p SET "production_service_id" = s."id"
FROM "service_catalog" s WHERE p."code" = 'SVC:' || s."code" AND p."production_service_id" IS NULL;

-- ── bundel katalog ───────────────────────────────────────────────────────────────────────────────────
CREATE TABLE "pkr_bundle_components" (
    "id" UUID NOT NULL,
    "bundle_category_id" UUID NOT NULL,
    "bundle_product_id" UUID,
    "component_category_id" UUID NOT NULL,
    "component_product_id" UUID,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "pkr_bundle_components_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pkr_bundle_components_qty_chk" CHECK ("qty" >= 1 AND "qty" <= 20)
);
ALTER TABLE "pkr_bundle_components" ADD CONSTRAINT "pkr_bundle_components_bundle_category_id_fkey" FOREIGN KEY ("bundle_category_id") REFERENCES "pkr_item_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pkr_bundle_components" ADD CONSTRAINT "pkr_bundle_components_bundle_product_id_fkey" FOREIGN KEY ("bundle_product_id") REFERENCES "pkr_item_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pkr_bundle_components" ADD CONSTRAINT "pkr_bundle_components_component_category_id_fkey" FOREIGN KEY ("component_category_id") REFERENCES "pkr_item_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pkr_bundle_components" ADD CONSTRAINT "pkr_bundle_components_component_product_id_fkey" FOREIGN KEY ("component_product_id") REFERENCES "pkr_item_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "pkr_bundle_components_bundle_category_id_sort_order_idx" ON "pkr_bundle_components"("bundle_category_id", "sort_order");
-- Satu komponen (kategori+produk) hanya sekali per bundel (NULL produk dianggap satu nilai).
CREATE UNIQUE INDEX "pkr_bundle_components_unik" ON "pkr_bundle_components" (
  "bundle_category_id", COALESCE("bundle_product_id", '00000000-0000-0000-0000-000000000000'::uuid),
  "component_category_id", COALESCE("component_product_id", '00000000-0000-0000-0000-000000000000'::uuid)
);

-- Komposisi awal Set Kasur Lengkap = Kasur + Divan + Sandaran (keputusan Owner). Admin dapat mengubahnya di Katalog Item PKR.
INSERT INTO "pkr_bundle_components" ("id", "bundle_category_id", "component_category_id", "qty", "sort_order", "updated_at")
SELECT gen_random_uuid(), b."id", c."id", 1, v."urut", CURRENT_TIMESTAMP
FROM "pkr_item_categories" b
JOIN (VALUES ('KASUR_BARU', 10), ('DIVAN_BOX', 20), ('SANDARAN', 30)) AS v("kode", "urut") ON TRUE
JOIN "pkr_item_categories" c ON c."code" = v."kode"
WHERE b."code" = 'SET_LENGKAP';

-- ── item order: asal bundel + penghapusan lunak ──────────────────────────────────────────────────────
ALTER TABLE "pkr_order_items" ADD COLUMN "bundle_no" INTEGER;
ALTER TABLE "pkr_order_items" ADD COLUMN "bundle_category_code" VARCHAR(40);
ALTER TABLE "pkr_order_items" ADD COLUMN "bundle_name" VARCHAR(160);
ALTER TABLE "pkr_order_items" ADD COLUMN "removed_at" TIMESTAMP(3);
ALTER TABLE "pkr_order_items" ADD COLUMN "removed_by_id" TEXT;
ALTER TABLE "pkr_order_items" ADD COLUMN "removed_reason" VARCHAR(500);
ALTER TABLE "pkr_order_items" ADD CONSTRAINT "pkr_order_items_removed_chk" CHECK (("removed_at" IS NULL) = ("removed_reason" IS NULL));

-- ── buku besar revisi item ───────────────────────────────────────────────────────────────────────────
CREATE TABLE "pkr_item_revisions" (
    "id" UUID NOT NULL,
    "order_id" TEXT NOT NULL,
    "penjualan_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "reason" VARCHAR(500),
    "before_items" JSONB,
    "after_items" JSONB NOT NULL,
    "impact" JSONB,
    "actor_id" TEXT,
    "idempotency_key" VARCHAR(128),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pkr_item_revisions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pkr_item_revisions_kind_chk" CHECK ("kind" IN ('DIBUAT', 'DILENGKAPI', 'DIKOREKSI')),
    CONSTRAINT "pkr_item_revisions_revision_chk" CHECK ("revision" >= 1),
    CONSTRAINT "pkr_item_revisions_alasan_chk" CHECK ("kind" <> 'DIKOREKSI' OR ("reason" IS NOT NULL AND length(btrim("reason")) >= 5))
);
ALTER TABLE "pkr_item_revisions" ADD CONSTRAINT "pkr_item_revisions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pkr_item_revisions" ADD CONSTRAINT "pkr_item_revisions_penjualan_id_fkey" FOREIGN KEY ("penjualan_id") REFERENCES "fin_penjualan_karyawan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Konkurensi optimistis di tingkat basis data: dua penulis yang membaca revisi yang sama hanya satu yang lolos.
CREATE UNIQUE INDEX "pkr_item_revisions_order_id_revision_key" ON "pkr_item_revisions"("order_id", "revision");
CREATE UNIQUE INDEX "pkr_item_revisions_order_id_idem_key" ON "pkr_item_revisions"("order_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL;
CREATE INDEX "pkr_item_revisions_penjualan_id_idx" ON "pkr_item_revisions"("penjualan_id");

CREATE OR REPLACE FUNCTION pkr_item_revisions_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'pkr_item_revisions append-only: baris % tidak boleh diubah atau dihapus', OLD."id" USING ERRCODE = 'restrict_violation';
END $$;
CREATE TRIGGER pkr_item_revisions_append_only_trg BEFORE UPDATE OR DELETE ON "pkr_item_revisions" FOR EACH ROW EXECUTE FUNCTION pkr_item_revisions_append_only();

-- ── catatan pengiriman sebagian ──────────────────────────────────────────────────────────────────────
CREATE TABLE "pkr_pengiriman_sebagian" (
    "id" UUID NOT NULL,
    "order_id" TEXT NOT NULL,
    "penjualan_id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "unit_ids" JSONB NOT NULL,
    "unit_codes" JSONB NOT NULL,
    "unit_ditunda" JSONB NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "actor_id" TEXT,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pkr_pengiriman_sebagian_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pkr_pengiriman_sebagian_alasan_chk" CHECK (length(btrim("reason")) >= 5)
);
ALTER TABLE "pkr_pengiriman_sebagian" ADD CONSTRAINT "pkr_pengiriman_sebagian_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pkr_pengiriman_sebagian" ADD CONSTRAINT "pkr_pengiriman_sebagian_penjualan_id_fkey" FOREIGN KEY ("penjualan_id") REFERENCES "fin_penjualan_karyawan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pkr_pengiriman_sebagian" ADD CONSTRAINT "pkr_pengiriman_sebagian_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "pkr_pengiriman_sebagian_order_id_idempotency_key_key" ON "pkr_pengiriman_sebagian"("order_id", "idempotency_key");
CREATE INDEX "pkr_pengiriman_sebagian_order_id_idx" ON "pkr_pengiriman_sebagian"("order_id");
