-- ATRIBUSI META ADS FASE 3 — spend harian per Ad ID, audit impor, revisi snapshot, target KPI, status alarm (Okt 2026).
-- MIGRASI ADITIF: 5 tabel BARU (kosong). Tidak ada kolom/baris lama yang diubah atau dihapus. Tidak ada backfill. Tidak menyimpan token atau respons mentah Meta.
--
--   meta_spend_imports      : log setiap impor/sinkronisasi spend (sumber, akun, rentang tanggal, hitungan, total spend, total deklarasi sumber). Tanpa isi berkas.
--   meta_ad_daily_spend     : satu baris per tanggal WIB + akun + Ad ID + sumber. ID = string digit (kunci); nama = label. Mata uang hanya IDR. Spend >= 0.
--                             Upsert idempoten; perubahan nilai pada impor ulang menyimpan nilai lama di meta_ad_spend_revisions.
--   meta_ad_spend_revisions : jejak audit append-only nilai lama setiap kali snapshot spend sebuah hari diperbarui.
--   attribution_kpi_targets : konfigurasi ADMIN (satu baris, id = 1). Semua target NULL sampai Owner mengisinya. Hanya dibaca untuk status evaluasi; tidak mengubah iklan.
--   attribution_alert_state : status terakhir tiap kondisi monitoring (OK/WARN/CRIT) untuk cooldown dan notifikasi pulih. Hanya agregat; tanpa data pribadi.

CREATE TABLE "meta_spend_imports" (
    "id" UUID NOT NULL,
    "source" VARCHAR(24) NOT NULL,
    "account_id" VARCHAR(32) NOT NULL,
    "file_name" VARCHAR(120),
    "content_sha256" VARCHAR(64) NOT NULL,
    "date_from" DATE,
    "date_to" DATE,
    "account_timezone" VARCHAR(40),
    "rows_total" INTEGER NOT NULL,
    "rows_accepted" INTEGER NOT NULL,
    "rows_rejected" INTEGER NOT NULL,
    "rows_new" INTEGER NOT NULL,
    "rows_updated" INTEGER NOT NULL,
    "rows_unchanged" INTEGER NOT NULL,
    "spend_total" DECIMAL(18,2) NOT NULL,
    "declared_total" DECIMAL(18,2),
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meta_spend_imports_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "meta_spend_imports_source_check" CHECK ("source" IN ('ADS_MANAGER_CSV', 'META_MARKETING_API', 'WINDSOR_API')),
    CONSTRAINT "meta_spend_imports_account_check" CHECK ("account_id" ~ '^[0-9]{5,32}$'),
    CONSTRAINT "meta_spend_imports_counts_check" CHECK ("rows_total" >= 0 AND "rows_accepted" >= 0 AND "rows_rejected" >= 0 AND "rows_new" >= 0 AND "rows_updated" >= 0 AND "rows_unchanged" >= 0),
    CONSTRAINT "meta_spend_imports_spend_check" CHECK ("spend_total" >= 0 AND ("declared_total" IS NULL OR "declared_total" >= 0))
);

CREATE TABLE "meta_ad_daily_spend" (
    "id" UUID NOT NULL,
    "date_wib" DATE NOT NULL,
    "account_id" VARCHAR(32) NOT NULL,
    "campaign_id" VARCHAR(32) NOT NULL,
    "ad_set_id" VARCHAR(32) NOT NULL,
    "ad_id" VARCHAR(32) NOT NULL,
    "campaign_name" VARCHAR(200),
    "ad_set_name" VARCHAR(200),
    "ad_name" VARCHAR(200),
    "currency" VARCHAR(3) NOT NULL,
    "spend" DECIMAL(18,2) NOT NULL,
    "impressions" BIGINT,
    "reach" BIGINT,
    "link_clicks" BIGINT,
    "platform_conversations" INTEGER,
    "platform_result_type" VARCHAR(80),
    "source" VARCHAR(24) NOT NULL,
    "account_timezone" VARCHAR(40),
    "source_updated_at" TIMESTAMP(3),
    "imported_at" TIMESTAMP(3) NOT NULL,
    "import_id" UUID NOT NULL,
    "row_checksum" VARCHAR(64) NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meta_ad_daily_spend_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "meta_ad_daily_spend_ids_check" CHECK ("account_id" ~ '^[0-9]{5,32}$' AND "campaign_id" ~ '^[0-9]{5,32}$' AND "ad_set_id" ~ '^[0-9]{5,32}$' AND "ad_id" ~ '^[0-9]{5,32}$'),
    CONSTRAINT "meta_ad_daily_spend_hierarchy_check" CHECK ("ad_id" <> "ad_set_id" AND "ad_id" <> "campaign_id" AND "ad_set_id" <> "campaign_id"),
    CONSTRAINT "meta_ad_daily_spend_currency_check" CHECK ("currency" = 'IDR'),
    CONSTRAINT "meta_ad_daily_spend_spend_check" CHECK ("spend" >= 0),
    CONSTRAINT "meta_ad_daily_spend_metrics_check" CHECK (
        ("impressions" IS NULL OR "impressions" >= 0) AND ("reach" IS NULL OR "reach" >= 0)
        AND ("link_clicks" IS NULL OR "link_clicks" >= 0) AND ("platform_conversations" IS NULL OR "platform_conversations" >= 0)
    ),
    CONSTRAINT "meta_ad_daily_spend_source_check" CHECK ("source" IN ('ADS_MANAGER_CSV', 'META_MARKETING_API', 'WINDSOR_API')),
    CONSTRAINT "meta_ad_daily_spend_revision_check" CHECK ("revision" >= 1)
);

CREATE TABLE "meta_ad_spend_revisions" (
    "id" UUID NOT NULL,
    "spend_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "prev_spend" DECIMAL(18,2) NOT NULL,
    "prev_impressions" BIGINT,
    "prev_reach" BIGINT,
    "prev_link_clicks" BIGINT,
    "prev_platform_conversations" INTEGER,
    "prev_checksum" VARCHAR(64) NOT NULL,
    "prev_import_id" UUID NOT NULL,
    "prev_imported_at" TIMESTAMP(3) NOT NULL,
    "revised_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "new_import_id" UUID NOT NULL,

    CONSTRAINT "meta_ad_spend_revisions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "attribution_kpi_targets" (
    "id" SMALLINT NOT NULL DEFAULT 1,
    "max_cpl" DECIMAL(18,2),
    "max_cost_per_qualified_lead" DECIMAL(18,2),
    "max_cost_per_customer_order" DECIMAL(18,2),
    "max_cpa_closing" DECIMAL(18,2),
    "min_booked_roas" DECIMAL(10,2),
    "min_cash_roas" DECIMAL(10,2),
    "min_acquisition_leads" INTEGER,
    "min_closings" INTEGER,
    "min_cohort_age_days" INTEGER,
    "max_spam_share_percent" DECIMAL(5,2),
    "updated_by_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attribution_kpi_targets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "attribution_kpi_targets_singleton_check" CHECK ("id" = 1),
    CONSTRAINT "attribution_kpi_targets_nonneg_check" CHECK (
        ("max_cpl" IS NULL OR "max_cpl" >= 0) AND ("max_cost_per_qualified_lead" IS NULL OR "max_cost_per_qualified_lead" >= 0)
        AND ("max_cost_per_customer_order" IS NULL OR "max_cost_per_customer_order" >= 0) AND ("max_cpa_closing" IS NULL OR "max_cpa_closing" >= 0)
        AND ("min_booked_roas" IS NULL OR "min_booked_roas" >= 0) AND ("min_cash_roas" IS NULL OR "min_cash_roas" >= 0)
        AND ("min_acquisition_leads" IS NULL OR "min_acquisition_leads" >= 0) AND ("min_closings" IS NULL OR "min_closings" >= 0)
        AND ("min_cohort_age_days" IS NULL OR "min_cohort_age_days" >= 0)
        AND ("max_spam_share_percent" IS NULL OR ("max_spam_share_percent" >= 0 AND "max_spam_share_percent" <= 100))
    )
);

CREATE TABLE "attribution_alert_state" (
    "key" VARCHAR(64) NOT NULL,
    "status" VARCHAR(8) NOT NULL,
    "since" TIMESTAMP(3) NOT NULL,
    "last_notified_at" TIMESTAMP(3),
    "detail" VARCHAR(200),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attribution_alert_state_pkey" PRIMARY KEY ("key"),
    CONSTRAINT "attribution_alert_state_status_check" CHECK ("status" IN ('OK', 'WARN', 'CRIT'))
);

CREATE UNIQUE INDEX "meta_ad_daily_spend_key" ON "meta_ad_daily_spend"("date_wib", "account_id", "ad_id", "source");
CREATE INDEX "meta_ad_daily_spend_date_wib_idx" ON "meta_ad_daily_spend"("date_wib");
CREATE INDEX "meta_ad_daily_spend_ad_id_date_wib_idx" ON "meta_ad_daily_spend"("ad_id", "date_wib");
CREATE INDEX "meta_ad_daily_spend_campaign_id_date_wib_idx" ON "meta_ad_daily_spend"("campaign_id", "date_wib");
CREATE INDEX "meta_ad_spend_revisions_spend_id_idx" ON "meta_ad_spend_revisions"("spend_id");

ALTER TABLE "meta_ad_daily_spend" ADD CONSTRAINT "meta_ad_daily_spend_import_id_fkey"
    FOREIGN KEY ("import_id") REFERENCES "meta_spend_imports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "meta_ad_spend_revisions" ADD CONSTRAINT "meta_ad_spend_revisions_spend_id_fkey"
    FOREIGN KEY ("spend_id") REFERENCES "meta_ad_daily_spend"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
