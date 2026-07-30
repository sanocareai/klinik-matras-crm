-- Revisi 30 Jul 2026: PipelineStage dari 8 nilai turun jadi 7 — PAID dihapus.
-- Alasan bisnis: PAID redundan dengan Order.paymentStatus (BELUM_BAYAR/DP/
-- LUNAS) yang sudah ada per-order (lebih presisi — 1 pelanggan bisa punya
-- beberapa order dengan status bayar beda-beda, tidak pernah bisa diwakili
-- 1 stage pipeline tunggal). Sempat dicoba sinkron otomatis (pipeline "Paid"
-- -> semua order pelanggan itu jadi LUNAS) tapi itu cuma tambal gejala,
-- bukan membereskan akar masalahnya (2 sumber kebenaran untuk 1 konsep).
--
-- Sama seperti migrasi 20260726120000 (hapus LOST): Postgres tidak bisa
-- DROP nilai enum yang sudah dipakai kolom dalam 1 ALTER TYPE sederhana,
-- jadi jalur amannya: bikin tipe enum baru, migrasi data lewat kolom
-- sementara, baru drop tipe lama & rename tipe baru.
--
-- Mapping data: PAID -> COMPLETED (stage TEPAT SEBELUM Paid di urutan lama —
-- sekarang jadi stage terakhir "operasional" sebelum Reviewed, dan jadi
-- trigger baru webhook otomasi "lead.won", gantikan PAID).

-- 1. Tipe enum baru (7 nilai, tanpa PAID)
CREATE TYPE "PipelineStage_new" AS ENUM ('NEW', 'QUALIFIED', 'QUOTED', 'BOOKED', 'SCHEDULED', 'COMPLETED', 'REVIEWED');

-- 2. Customer.pipelineStage
ALTER TABLE "Customer" ADD COLUMN "pipelineStage_new" "PipelineStage_new";
UPDATE "Customer" SET "pipelineStage_new" = (
  CASE "pipelineStage"::text
    WHEN 'PAID' THEN 'COMPLETED'
    ELSE "pipelineStage"::text
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
      WHEN 'PAID' THEN 'COMPLETED'
      ELSE "from_stage"::text
    END
  )::"PipelineStage_new",
  "to_stage_new" = (
    CASE "to_stage"::text
      WHEN 'PAID' THEN 'COMPLETED'
      ELSE "to_stage"::text
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
