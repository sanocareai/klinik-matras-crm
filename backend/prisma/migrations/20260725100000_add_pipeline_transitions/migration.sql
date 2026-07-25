-- Riwayat perpindahan pipeline stage per customer (ADDITIVE ONLY).
-- Tujuan: menggeser laporan dari agregat "berapa di stage X sekarang" ke
-- data time-series (kecepatan pipeline, cohort, tren konversi per periode).
--
-- Reversible rollback (jalankan manual bila perlu revert):
--   DROP TABLE "pipeline_transitions";
-- Tidak ada kolom/tabel lain yang diubah. Tidak ada enum baru
-- ("PipelineStage" sudah ada sejak migrasi init).
--
-- created_at disimpan UTC (TIMESTAMP(3), sama seperti semua tabel lain) —
-- konversi ke WIB terjadi di tepi, lihat backend/src/utils/wib.js.

-- CreateTable
CREATE TABLE "pipeline_transitions" (
    "id" UUID NOT NULL,
    "customer_id" TEXT NOT NULL,
    "from_stage" "PipelineStage" NOT NULL,
    "to_stage" "PipelineStage" NOT NULL,
    "changed_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pipeline_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pipeline_transitions_customer_id_created_at_idx" ON "pipeline_transitions"("customer_id", "created_at");

-- CreateIndex
CREATE INDEX "pipeline_transitions_created_at_idx" ON "pipeline_transitions"("created_at");

-- CreateIndex
CREATE INDEX "pipeline_transitions_to_stage_created_at_idx" ON "pipeline_transitions"("to_stage", "created_at");

-- AddForeignKey
ALTER TABLE "pipeline_transitions" ADD CONSTRAINT "pipeline_transitions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_transitions" ADD CONSTRAINT "pipeline_transitions_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
