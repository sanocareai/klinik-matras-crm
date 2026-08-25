-- Revisi 24 Agustus 2026: PipelineStage dari 7 nilai turun jadi 4 —
-- restrukturisasi besar, bukan cuma hapus 1 nilai seperti 2 migrasi
-- sebelumnya (20260726120000, 20260730120000).
--
-- Alasan bisnis: Order sudah punya OrderStatus sendiri (PENDING/PICKUP/
-- PROCESSING/READY/DELIVERED/CANCELLED) yang men-track fulfillment per-order
-- secara independen — jadi pipelineStage tidak perlu lagi menduplikasi
-- progres operasional (BOOKED/SCHEDULED/COMPLETED/REVIEWED), cukup menjawab
-- "posisi lead ini di funnel". SPAM ditambahkan supaya chat junk (1-2x balas
-- lalu hilang, pesan tidak jelas, salah sasaran) bisa dikecualikan secara
-- eksplisit dari perhitungan Closing Rate — sebelumnya chat semacam ini ikut
-- jadi penyebut laporan performa sales, bikin closing rate sales yang
-- sebenarnya bagus terlihat rendah.
--
-- Mapping data (BUKAN retroaktif untuk SPAM — tidak ada customer lama yang
-- otomatis ditandai spam, itu keputusan sales ke depan):
--   NEW                                    -> NEW
--   QUALIFIED, QUOTED                      -> PROSPECT
--   BOOKED, SCHEDULED, COMPLETED, REVIEWED -> TRANSACTION
--
-- Sinyal "sudah kasih review" (REVIEWED lama) SENGAJA dilepas, bukan
-- dipindah ke field lain — keputusan bisnis eksplisit 24 Agustus 2026.
--
-- Pola sama seperti 2 migrasi sebelumnya: Postgres tidak bisa DROP nilai
-- enum yang sudah dipakai kolom dalam 1 ALTER TYPE sederhana, jadi jalur
-- amannya: bikin tipe enum baru, migrasi data lewat kolom sementara, baru
-- drop tipe lama & rename tipe baru.

-- 1. Tipe enum baru (4 nilai)
CREATE TYPE "PipelineStage_new" AS ENUM ('NEW', 'PROSPECT', 'TRANSACTION', 'SPAM');

-- 2. Customer.pipelineStage
ALTER TABLE "Customer" ADD COLUMN "pipelineStage_new" "PipelineStage_new";
UPDATE "Customer" SET "pipelineStage_new" = (
  CASE "pipelineStage"::text
    WHEN 'NEW' THEN 'NEW'
    WHEN 'QUALIFIED' THEN 'PROSPECT'
    WHEN 'QUOTED' THEN 'PROSPECT'
    WHEN 'BOOKED' THEN 'TRANSACTION'
    WHEN 'SCHEDULED' THEN 'TRANSACTION'
    WHEN 'COMPLETED' THEN 'TRANSACTION'
    WHEN 'REVIEWED' THEN 'TRANSACTION'
    ELSE 'NEW'
  END
)::"PipelineStage_new";
ALTER TABLE "Customer" ALTER COLUMN "pipelineStage_new" SET NOT NULL;
ALTER TABLE "Customer" ALTER COLUMN "pipelineStage_new" SET DEFAULT 'NEW';
ALTER TABLE "Customer" DROP COLUMN "pipelineStage";
ALTER TABLE "Customer" RENAME COLUMN "pipelineStage_new" TO "pipelineStage";

-- 3. pipeline_transitions.from_stage / to_stage (riwayat — dipetakan dengan
--    mapping YANG SAMA supaya laporan time-series lama tetap konsisten,
--    walau resolusinya sekarang lebih kasar dari histori aslinya)
ALTER TABLE "pipeline_transitions" ADD COLUMN "from_stage_new" "PipelineStage_new";
ALTER TABLE "pipeline_transitions" ADD COLUMN "to_stage_new" "PipelineStage_new";
UPDATE "pipeline_transitions" SET
  "from_stage_new" = (
    CASE "from_stage"::text
      WHEN 'NEW' THEN 'NEW'
      WHEN 'QUALIFIED' THEN 'PROSPECT'
      WHEN 'QUOTED' THEN 'PROSPECT'
      WHEN 'BOOKED' THEN 'TRANSACTION'
      WHEN 'SCHEDULED' THEN 'TRANSACTION'
      WHEN 'COMPLETED' THEN 'TRANSACTION'
      WHEN 'REVIEWED' THEN 'TRANSACTION'
      ELSE 'NEW'
    END
  )::"PipelineStage_new",
  "to_stage_new" = (
    CASE "to_stage"::text
      WHEN 'NEW' THEN 'NEW'
      WHEN 'QUALIFIED' THEN 'PROSPECT'
      WHEN 'QUOTED' THEN 'PROSPECT'
      WHEN 'BOOKED' THEN 'TRANSACTION'
      WHEN 'SCHEDULED' THEN 'TRANSACTION'
      WHEN 'COMPLETED' THEN 'TRANSACTION'
      WHEN 'REVIEWED' THEN 'TRANSACTION'
      ELSE 'NEW'
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
