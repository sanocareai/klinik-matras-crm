-- ATRIBUSI CTWA FASE 2 — touch iklan per customer + referensi Ad → Ad Set → Campaign (Okt 2026).
-- MIGRASI ADITIF: 3 tabel BARU (kosong) + indeks + FK + CHECK. Tidak ada kolom/baris lama yang diubah atau dihapus, TIDAK ADA backfill.
-- Tidak ada atribusi historis: touch hanya lahir dari pesan inbound yang diproses SETELAH flag ATRIBUSI_TOUCH_CAPTURE_ENABLED=true.
--
--   attribution_touches            : satu baris per pesan inbound bersinyal iklan CTWA yang valid (sourceID numerik + sourceType=ad).
--                                    APPEND-ONLY. Tanpa isi chat, nomor, nama, payload mentah, atau clid mentah (hanya hash 16 hex).
--                                    ad_id = string digit (bukan angka) — ID Meta melebihi presisi aman bila diperlakukan numerik di klien.
--                                    ad_set_id/campaign_id = SNAPSHOT saat touch (NULL = belum terpetakan saat itu); laporan memakai referensi TERKINI.
--                                    touch_at = UTC (konvensi seluruh kolom waktu); touch_date_wib = hari kalender WIB (UTC+7), dijaga CHECK.
--   meta_ad_references             : relasi Ad ID → Ad Set ID → Campaign ID yang dapat diperbarui. ID adalah kunci; nama = label snapshot.
--   meta_ad_reference_imports      : log setiap impor pemetaan (sumber, sidik jari berkas, hitungan) — tanpa isi berkas.

CREATE TABLE "meta_ad_reference_imports" (
    "id" UUID NOT NULL,
    "source" VARCHAR(24) NOT NULL,
    "file_name" VARCHAR(120),
    "content_sha256" VARCHAR(64) NOT NULL,
    "rows_total" INTEGER NOT NULL,
    "rows_accepted" INTEGER NOT NULL,
    "rows_rejected" INTEGER NOT NULL,
    "rows_new" INTEGER NOT NULL,
    "rows_changed" INTEGER NOT NULL,
    "allow_correction" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meta_ad_reference_imports_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "meta_ad_reference_imports_source_check" CHECK ("source" IN ('ADS_MANAGER_EXPORT', 'MARKETING_API', 'MANUAL')),
    CONSTRAINT "meta_ad_reference_imports_counts_check" CHECK ("rows_total" >= 0 AND "rows_accepted" >= 0 AND "rows_rejected" >= 0 AND "rows_new" >= 0 AND "rows_changed" >= 0)
);

CREATE TABLE "meta_ad_references" (
    "ad_id" VARCHAR(32) NOT NULL,
    "ad_set_id" VARCHAR(32) NOT NULL,
    "campaign_id" VARCHAR(32) NOT NULL,
    "ad_name" VARCHAR(200),
    "ad_set_name" VARCHAR(200),
    "campaign_name" VARCHAR(200),
    "source" VARCHAR(24) NOT NULL,
    "synced_at" TIMESTAMP(3) NOT NULL,
    "import_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meta_ad_references_pkey" PRIMARY KEY ("ad_id"),
    CONSTRAINT "meta_ad_references_ids_check" CHECK ("ad_id" ~ '^[0-9]{5,32}$' AND "ad_set_id" ~ '^[0-9]{5,32}$' AND "campaign_id" ~ '^[0-9]{5,32}$'),
    CONSTRAINT "meta_ad_references_hierarchy_check" CHECK ("ad_id" <> "ad_set_id" AND "ad_id" <> "campaign_id" AND "ad_set_id" <> "campaign_id"),
    CONSTRAINT "meta_ad_references_source_check" CHECK ("source" IN ('ADS_MANAGER_EXPORT', 'MARKETING_API', 'MANUAL'))
);

CREATE TABLE "attribution_touches" (
    "id" UUID NOT NULL,
    "customer_id" TEXT NOT NULL,
    "message_id" TEXT,
    "ad_id" VARCHAR(32) NOT NULL,
    "ad_set_id" VARCHAR(32),
    "campaign_id" VARCHAR(32),
    "mapping_status_at_touch" VARCHAR(10) NOT NULL,
    "touch_at" TIMESTAMP(3) NOT NULL,
    "touch_date_wib" DATE NOT NULL,
    "provider_ts" TIMESTAMP(3),
    "evidence_source" VARCHAR(24) NOT NULL,
    "source_type" VARCHAR(16) NOT NULL,
    "entry_point_source" VARCHAR(32),
    "entry_point_app" VARCHAR(32),
    "ctwa_clid_hash" VARCHAR(16),
    "customer_new_at_touch" BOOLEAN NOT NULL,
    "dedupe_key" VARCHAR(64) NOT NULL,
    "capture_version" SMALLINT NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attribution_touches_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "attribution_touches_ad_id_check" CHECK ("ad_id" ~ '^[0-9]{5,32}$'),
    CONSTRAINT "attribution_touches_parent_ids_check" CHECK (
        ("ad_set_id" IS NULL OR "ad_set_id" ~ '^[0-9]{5,32}$') AND ("campaign_id" IS NULL OR "campaign_id" ~ '^[0-9]{5,32}$')
    ),
    CONSTRAINT "attribution_touches_mapping_check" CHECK (
        ("mapping_status_at_touch" = 'MAPPED' AND "ad_set_id" IS NOT NULL AND "campaign_id" IS NOT NULL)
        OR ("mapping_status_at_touch" = 'UNMAPPED' AND "ad_set_id" IS NULL AND "campaign_id" IS NULL)
    ),
    CONSTRAINT "attribution_touches_evidence_check" CHECK ("evidence_source" IN ('CTWA_AD', 'AD_REPLY_UNMARKED')),
    CONSTRAINT "attribution_touches_source_type_check" CHECK ("source_type" = 'ad'),
    CONSTRAINT "attribution_touches_clid_hash_check" CHECK ("ctwa_clid_hash" IS NULL OR "ctwa_clid_hash" ~ '^[0-9a-f]{16}$'),
    CONSTRAINT "attribution_touches_date_wib_check" CHECK ("touch_date_wib" = (("touch_at" + INTERVAL '7 hours')::date))
);

CREATE UNIQUE INDEX "attribution_touches_dedupe_key_key" ON "attribution_touches"("dedupe_key");
CREATE INDEX "attribution_touches_customer_id_touch_at_idx" ON "attribution_touches"("customer_id", "touch_at");
CREATE INDEX "attribution_touches_ad_id_touch_at_idx" ON "attribution_touches"("ad_id", "touch_at");
CREATE INDEX "attribution_touches_touch_date_wib_idx" ON "attribution_touches"("touch_date_wib");
CREATE INDEX "meta_ad_references_campaign_id_idx" ON "meta_ad_references"("campaign_id");
CREATE INDEX "meta_ad_references_ad_set_id_idx" ON "meta_ad_references"("ad_set_id");

ALTER TABLE "meta_ad_reference_imports" ADD CONSTRAINT "meta_ad_reference_imports_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "meta_ad_references" ADD CONSTRAINT "meta_ad_references_import_id_fkey"
    FOREIGN KEY ("import_id") REFERENCES "meta_ad_reference_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "attribution_touches" ADD CONSTRAINT "attribution_touches_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attribution_touches" ADD CONSTRAINT "attribution_touches_message_id_fkey"
    FOREIGN KEY ("message_id") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
