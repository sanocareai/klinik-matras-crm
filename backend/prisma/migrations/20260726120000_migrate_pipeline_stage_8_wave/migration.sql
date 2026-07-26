-- Revisi 26 Jul 2026: PipelineStage dari 5 nilai (LEAD/QUALIFIED/QUOTED/WON/LOST)
-- jadi 8 nilai (NEW/QUALIFIED/QUOTED/BOOKED/SCHEDULED/COMPLETED/PAID/REVIEWED).
-- Postgres tidak bisa RENAME/DROP nilai enum yang sudah dipakai kolom dalam
-- satu ALTER TYPE sederhana (apalagi sambil mapping N:1 seperti LOST->QUALIFIED),
-- jadi jalur amannya: bikin tipe enum BARU, migrasi data lewat kolom sementara,
-- baru drop tipe lama & rename tipe baru supaya nama akhirnya tetap "PipelineStage".
--
-- Mapping data (keputusan bisnis, BUKAN cuma rename):
--   LEAD       -> NEW
--   QUALIFIED  -> QUALIFIED   (sama)
--   QUOTED     -> QUOTED      (sama)
--   WON        -> PAID        (deal lama dianggap sudah lunas)
--   LOST       -> QUALIFIED   (stage Lost dihapus, dikembalikan ke Qualified)

-- 1. Tipe enum baru
CREATE TYPE "PipelineStage_new" AS ENUM ('NEW', 'QUALIFIED', 'QUOTED', 'BOOKED', 'SCHEDULED', 'COMPLETED', 'PAID', 'REVIEWED');

-- 2. Customer.pipelineStage
ALTER TABLE "Customer" ADD COLUMN "pipelineStage_new" "PipelineStage_new";
UPDATE "Customer" SET "pipelineStage_new" = (
  CASE "pipelineStage"::text
    WHEN 'LEAD' THEN 'NEW'
    WHEN 'QUALIFIED' THEN 'QUALIFIED'
    WHEN 'QUOTED' THEN 'QUOTED'
    WHEN 'WON' THEN 'PAID'
    WHEN 'LOST' THEN 'QUALIFIED'
  END
)::"PipelineStage_new";
ALTER TABLE "Customer" ALTER COLUMN "pipelineStage_new" SET NOT NULL;
ALTER TABLE "Customer" ALTER COLUMN "pipelineStage_new" SET DEFAULT 'NEW';
ALTER TABLE "Customer" DROP COLUMN "pipelineStage";
ALTER TABLE "Customer" RENAME COLUMN "pipelineStage_new" TO "pipelineStage";

-- 3. pipeline_transitions.from_stage / to_stage (riwayat — dipetakan dengan
--    mapping YANG SAMA supaya laporan time-series lama tetap konsisten)
ALTER TABLE "pipeline_transitions" ADD COLUMN "from_stage_new" "PipelineStage_new";
ALTER TABLE "pipeline_transitions" ADD COLUMN "to_stage_new" "PipelineStage_new";
UPDATE "pipeline_transitions" SET
  "from_stage_new" = (
    CASE "from_stage"::text
      WHEN 'LEAD' THEN 'NEW'
      WHEN 'QUALIFIED' THEN 'QUALIFIED'
      WHEN 'QUOTED' THEN 'QUOTED'
      WHEN 'WON' THEN 'PAID'
      WHEN 'LOST' THEN 'QUALIFIED'
    END
  )::"PipelineStage_new",
  "to_stage_new" = (
    CASE "to_stage"::text
      WHEN 'LEAD' THEN 'NEW'
      WHEN 'QUALIFIED' THEN 'QUALIFIED'
      WHEN 'QUOTED' THEN 'QUOTED'
      WHEN 'WON' THEN 'PAID'
      WHEN 'LOST' THEN 'QUALIFIED'
    END
  )::"PipelineStage_new";
ALTER TABLE "pipeline_transitions" ALTER COLUMN "from_stage_new" SET NOT NULL;
ALTER TABLE "pipeline_transitions" ALTER COLUMN "to_stage_new" SET NOT NULL;
ALTER TABLE "pipeline_transitions" DROP COLUMN "from_stage";
ALTER TABLE "pipeline_transitions" DROP COLUMN "to_stage";
ALTER TABLE "pipeline_transitions" RENAME COLUMN "from_stage_new" TO "from_stage";
ALTER TABLE "pipeline_transitions" RENAME COLUMN "to_stage_new" TO "to_stage";

-- 4. Buang tipe lama, ganti nama tipe baru supaya identitasnya tetap "PipelineStage"
DROP TYPE "PipelineStage";
ALTER TYPE "PipelineStage_new" RENAME TO "PipelineStage";

-- 5. Index yang sempat ikut ke-drop bareng kolom (Postgres drop index otomatis
--    saat kolom dihapus) — buat ulang supaya tetap identik dengan schema.prisma
CREATE INDEX "pipeline_transitions_to_stage_created_at_idx" ON "pipeline_transitions"("to_stage", "created_at");
