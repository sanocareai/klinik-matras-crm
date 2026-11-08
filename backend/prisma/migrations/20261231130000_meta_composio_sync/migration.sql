-- Sinkronisasi Meta lewat Composio. ADITIF SAJA: dua kolom nullable + tabel baru. Tidak mengubah/menghapus baris yang ada; tidak menyentuh customer, chat, touch, order, payment.
ALTER TABLE "meta_spend_imports" ADD COLUMN "transport" VARCHAR(24);
ALTER TABLE "meta_ad_reference_imports" ADD COLUMN "transport" VARCHAR(24);

CREATE TABLE "meta_sync_runs" (
  "id" UUID NOT NULL,
  "account_id" VARCHAR(32) NOT NULL,
  "transport" VARCHAR(24) NOT NULL,
  "mode" VARCHAR(12) NOT NULL,
  "status" VARCHAR(30) NOT NULL,
  "date_from" DATE,
  "date_to" DATE,
  "checkpoint_date" DATE,
  "complete_through" DATE,
  "control_spend" DECIMAL(18,2),
  "ad_spend" DECIMAL(18,2),
  "selisih_spend" DECIMAL(18,2),
  "unmapped_ads" INTEGER,
  "days_reconciled" INTEGER,
  "days_held" INTEGER,
  "failure_code" VARCHAR(60),
  "attribution" JSONB,
  "summary" JSONB,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" TIMESTAMP(3),
  CONSTRAINT "meta_sync_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "meta_sync_runs_account_id_started_at_idx" ON "meta_sync_runs"("account_id", "started_at");
-- kunci: paling banyak satu run BERJALAN per akun
CREATE UNIQUE INDEX "meta_sync_runs_satu_berjalan" ON "meta_sync_runs"("account_id") WHERE "status" = 'RUNNING';

CREATE TABLE "meta_account_daily_control" (
  "date_wib" DATE NOT NULL,
  "account_id" VARCHAR(32) NOT NULL,
  "status" VARCHAR(30) NOT NULL,
  "control_spend" DECIMAL(18,2),
  "control_impressions" BIGINT,
  "control_link_clicks" BIGINT,
  "control_conversations" INTEGER,
  "ad_spend" DECIMAL(18,2),
  "ad_rows" INTEGER,
  "reconciled" BOOLEAN NOT NULL DEFAULT false,
  "transport" VARCHAR(24) NOT NULL,
  "run_id" UUID,
  "fetched_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "meta_account_daily_control_pkey" PRIMARY KEY ("date_wib", "account_id")
);

CREATE TABLE "meta_ad_daily_delivery" (
  "date_wib" DATE NOT NULL,
  "account_id" VARCHAR(32) NOT NULL,
  "ad_id" VARCHAR(32) NOT NULL,
  "video_3s_views" BIGINT,
  "video_thruplays" BIGINT,
  "impressions" BIGINT,
  "transport" VARCHAR(24) NOT NULL,
  "run_id" UUID,
  "fetched_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "meta_ad_daily_delivery_pkey" PRIMARY KEY ("date_wib", "account_id", "ad_id")
);

-- Breakdown tingkat akun: tabel TERPISAH dari fakta Ad, tidak pernah dijumlahkan ke spend laporan. reach non-aditif: disimpan per baris, dilarang dijumlah.
CREATE TABLE "meta_account_daily_breakdowns" (
  "date_wib" DATE NOT NULL,
  "account_id" VARCHAR(32) NOT NULL,
  "dimension" VARCHAR(40) NOT NULL,
  "dimension_key" VARCHAR(120) NOT NULL,
  "spend" DECIMAL(18,2) NOT NULL,
  "impressions" BIGINT,
  "link_clicks" BIGINT,
  "reach" BIGINT,
  "transport" VARCHAR(24) NOT NULL,
  "run_id" UUID,
  "fetched_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "meta_account_daily_breakdowns_pkey" PRIMARY KEY ("date_wib", "account_id", "dimension", "dimension_key")
);

CREATE TABLE "meta_ad_creatives" (
  "ad_id" VARCHAR(32) NOT NULL,
  "account_id" VARCHAR(32) NOT NULL,
  "creative_id" VARCHAR(32),
  "creative_name" VARCHAR(200),
  "object_story_id" VARCHAR(80),
  "effective_object_story_id" VARCHAR(80),
  "video_id" VARCHAR(32),
  "transport" VARCHAR(24) NOT NULL,
  "fetched_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "meta_ad_creatives_pkey" PRIMARY KEY ("ad_id")
);
