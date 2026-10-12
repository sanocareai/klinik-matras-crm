-- PENJUALAN KARYAWAN — ITEM PENJUALAN & PEMENUHAN TERPADU (Okt 2026).
-- MIGRASI ADITIF: kolom NULLABLE + indeks + CHECK + 3 fungsi/trigger penjaga. Tidak ada baris lama yang diubah/dihapus dan TIDAK ADA backfill:
-- semua baris yang sudah ada (20 PKR, 32 baris penjualan, 2 order lama) tetap persis seperti sekarang (kolom baru NULL = "data lama").
--
-- Prinsip: SATU baris item penjualan (fin_penjualan_karyawan_items) = sumber kanonis. Dari baris yang sama: Finance menghitung total/piutang/jurnal, Order CRM membuat item operasional
-- (pkr_order_items), Produksi membuat unit, Delivery/Pickup mengikuti cara pemenuhan.
--
--   fin_penjualan_karyawan_items.category_id/product_id/category_code/category_name : kategori/produk katalog (snapshot nama; nama item = kolom "name" yang sudah ada).
--   fin_penjualan_karyawan_items.fulfillment : cara pemenuhan — PRODUKSI_BARU | SERVICE_PICKUP | AMBIL_STOK | TANPA_OPERASIONAL. NULL = baris lama / jalur lama (tidak ditebak).
--   fin_penjualan_karyawan_items.perlu_dikirim, length/width/thickness/height_cm, spec_notes : ukuran, spesifikasi, dikirim/diambil sendiri.
--   pkr_order_items.sale_item_id/component_seq/component_qty/fulfillment : tautan unik ke baris penjualan (satu baris Set -> beberapa komponen) + snapshot pemenuhan.
--   pkr_item_revisions.finance_before/finance_after : jejak audit sisi Finance (nama/jumlah/harga/total) untuk Koreksi atomik. HANYA dibaca endpoint Finance.
--
-- Jumlah/nama TIDAK BOLEH menyimpang: pkr_order_items.qty = fin item.quantity x component_qty, dan nama item operasional = nama baris penjualan. Dijaga trigger yang DITUNDA ke
-- akhir transaksi (Koreksi mengubah sisi Finance dan operasional dalam satu transaksi), jadi ketidaksesuaian apa pun menggagalkan COMMIT.

-- ── baris item penjualan ────────────────────────────────────────────────────────────────────────────
ALTER TABLE "fin_penjualan_karyawan_items" ADD COLUMN "category_id" UUID;
ALTER TABLE "fin_penjualan_karyawan_items" ADD COLUMN "product_id" UUID;
ALTER TABLE "fin_penjualan_karyawan_items" ADD COLUMN "category_code" VARCHAR(40);
ALTER TABLE "fin_penjualan_karyawan_items" ADD COLUMN "category_name" VARCHAR(100);
ALTER TABLE "fin_penjualan_karyawan_items" ADD COLUMN "fulfillment" VARCHAR(24);
ALTER TABLE "fin_penjualan_karyawan_items" ADD COLUMN "perlu_dikirim" BOOLEAN;
ALTER TABLE "fin_penjualan_karyawan_items" ADD COLUMN "length_cm" DECIMAL(7,1);
ALTER TABLE "fin_penjualan_karyawan_items" ADD COLUMN "width_cm" DECIMAL(7,1);
ALTER TABLE "fin_penjualan_karyawan_items" ADD COLUMN "thickness_cm" DECIMAL(7,1);
ALTER TABLE "fin_penjualan_karyawan_items" ADD COLUMN "height_cm" DECIMAL(7,1);
ALTER TABLE "fin_penjualan_karyawan_items" ADD COLUMN "spec_notes" VARCHAR(1000);

ALTER TABLE "fin_penjualan_karyawan_items" ADD CONSTRAINT "fin_penjualan_karyawan_items_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "pkr_item_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fin_penjualan_karyawan_items" ADD CONSTRAINT "fin_penjualan_karyawan_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "pkr_item_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "fin_penjualan_karyawan_items_category_id_idx" ON "fin_penjualan_karyawan_items"("category_id");

ALTER TABLE "fin_penjualan_karyawan_items" ADD CONSTRAINT "fin_pkr_items_fulfillment_chk"
  CHECK ("fulfillment" IS NULL OR "fulfillment" IN ('PRODUKSI_BARU', 'SERVICE_PICKUP', 'AMBIL_STOK', 'TANPA_OPERASIONAL'));
-- Baris lama / jalur lama (fulfillment NULL) tidak membawa data operasional sama sekali.
ALTER TABLE "fin_penjualan_karyawan_items" ADD CONSTRAINT "fin_pkr_items_lama_polos_chk"
  CHECK ("fulfillment" IS NOT NULL OR ("category_id" IS NULL AND "product_id" IS NULL AND "category_code" IS NULL AND "category_name" IS NULL AND "perlu_dikirim" IS NULL
    AND "length_cm" IS NULL AND "width_cm" IS NULL AND "thickness_cm" IS NULL AND "height_cm" IS NULL AND "spec_notes" IS NULL));
-- Pekerjaan Produksi/Pickup selalu punya kategori katalog (rute dihitung darinya).
ALTER TABLE "fin_penjualan_karyawan_items" ADD CONSTRAINT "fin_pkr_items_operasional_kategori_chk"
  CHECK ("fulfillment" IS NULL OR "fulfillment" IN ('AMBIL_STOK', 'TANPA_OPERASIONAL') OR "category_id" IS NOT NULL);
-- Item tanpa unit (stok / tanpa operasional) tidak punya unit untuk dikirim: tidak boleh ditandai "dikirim".
ALTER TABLE "fin_penjualan_karyawan_items" ADD CONSTRAINT "fin_pkr_items_tanpa_unit_kirim_chk"
  CHECK ("fulfillment" IS NULL OR "fulfillment" IN ('PRODUKSI_BARU', 'SERVICE_PICKUP') OR "perlu_dikirim" IS NOT TRUE);
ALTER TABLE "fin_penjualan_karyawan_items" ADD CONSTRAINT "fin_pkr_items_dim_chk"
  CHECK (("length_cm" IS NULL OR "length_cm" > 0) AND ("width_cm" IS NULL OR "width_cm" > 0) AND ("thickness_cm" IS NULL OR "thickness_cm" > 0) AND ("height_cm" IS NULL OR "height_cm" > 0));

-- ── item operasional ────────────────────────────────────────────────────────────────────────────────
ALTER TABLE "pkr_order_items" ADD COLUMN "sale_item_id" UUID;
ALTER TABLE "pkr_order_items" ADD COLUMN "component_seq" INTEGER;
ALTER TABLE "pkr_order_items" ADD COLUMN "component_qty" INTEGER;
ALTER TABLE "pkr_order_items" ADD COLUMN "fulfillment" VARCHAR(24);
-- SET NULL: baris penjualan yang dihapus lewat Koreksi meninggalkan item operasional yang SUDAH dihapus lunak (riwayat tetap); penjaga di bawah menolak penghapusan bila masih ada yang aktif.
ALTER TABLE "pkr_order_items" ADD CONSTRAINT "pkr_order_items_sale_item_id_fkey" FOREIGN KEY ("sale_item_id") REFERENCES "fin_penjualan_karyawan_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "pkr_order_items_sale_item_id_idx" ON "pkr_order_items"("sale_item_id");
-- Tautan UNIK: satu komponen operasional per baris penjualan (non-bundel = komponen 1; baris Set = komponen 1..n sesuai komposisi). Baris lama (sale_item_id NULL) tidak pernah bentrok: NULL dianggap berbeda.
CREATE UNIQUE INDEX "pkr_order_items_sale_component_key" ON "pkr_order_items"("sale_item_id", "component_seq");
ALTER TABLE "pkr_order_items" ADD CONSTRAINT "pkr_order_items_fulfillment_chk" CHECK ("fulfillment" IS NULL OR "fulfillment" IN ('PRODUKSI_BARU', 'SERVICE_PICKUP'));
ALTER TABLE "pkr_order_items" ADD CONSTRAINT "pkr_order_items_tautan_chk"
  CHECK ("sale_item_id" IS NULL OR ("component_seq" >= 1 AND "component_qty" >= 1 AND "fulfillment" IS NOT NULL));

-- ── jejak audit sisi Finance ────────────────────────────────────────────────────────────────────────
ALTER TABLE "pkr_item_revisions" ADD COLUMN "finance_before" JSONB;
ALTER TABLE "pkr_item_revisions" ADD COLUMN "finance_after" JSONB;

-- ── penjaga: jumlah/nama tidak boleh menyimpang antara baris penjualan dan item operasionalnya ─────────
CREATE FUNCTION "pkr_validasi_tautan_item"(p_sale UUID) RETURNS void AS $$
DECLARE
  s RECORD;
  r RECORD;
BEGIN
  SELECT "quantity", "name" INTO s FROM "fin_penjualan_karyawan_items" WHERE "id" = p_sale;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  FOR r IN
    SELECT "seq", "qty", "component_qty", "bundle_no", "product_name", "bundle_name"
    FROM "pkr_order_items" WHERE "sale_item_id" = p_sale AND "removed_at" IS NULL
  LOOP
    IF r."qty"::numeric <> s."quantity" * r."component_qty" THEN
      RAISE EXCEPTION 'PKR_TAUTAN_JUMLAH: item operasional % (qty %) tidak sama dengan jumlah baris penjualan (%) x komponen (%)', r."seq", r."qty", s."quantity", r."component_qty"
        USING ERRCODE = '23514';
    END IF;
    IF r."bundle_no" IS NULL AND r."product_name" IS DISTINCT FROM s."name" THEN
      RAISE EXCEPTION 'PKR_TAUTAN_NAMA: nama item operasional % tidak sama dengan nama baris penjualan', r."seq" USING ERRCODE = '23514';
    END IF;
    IF r."bundle_no" IS NOT NULL AND r."bundle_name" IS DISTINCT FROM s."name" THEN
      RAISE EXCEPTION 'PKR_TAUTAN_NAMA: nama set item operasional % tidak sama dengan nama baris penjualan', r."seq" USING ERRCODE = '23514';
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "pkr_trg_tautan_item_order"() RETURNS trigger AS $$
BEGIN
  IF NEW."sale_item_id" IS NOT NULL AND NEW."removed_at" IS NULL THEN
    PERFORM "pkr_validasi_tautan_item"(NEW."sale_item_id");
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "pkr_order_items_tautan_trg" AFTER INSERT OR UPDATE ON "pkr_order_items"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "pkr_trg_tautan_item_order"();

CREATE FUNCTION "pkr_trg_tautan_item_penjualan"() RETURNS trigger AS $$
BEGIN
  PERFORM "pkr_validasi_tautan_item"(NEW."id");
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "fin_penjualan_karyawan_items_tautan_trg" AFTER UPDATE OF "quantity", "name" ON "fin_penjualan_karyawan_items"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "pkr_trg_tautan_item_penjualan"();

CREATE FUNCTION "pkr_trg_cegah_hapus_item_penjualan"() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "pkr_order_items" WHERE "sale_item_id" = OLD."id" AND "removed_at" IS NULL) THEN
    RAISE EXCEPTION 'PKR_ITEM_MASIH_DIPAKAI: baris penjualan masih punya item operasional aktif — hapus lewat Koreksi Item';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "fin_penjualan_karyawan_items_cegah_hapus_trg" BEFORE DELETE ON "fin_penjualan_karyawan_items"
  FOR EACH ROW EXECUTE FUNCTION "pkr_trg_cegah_hapus_item_penjualan"();
