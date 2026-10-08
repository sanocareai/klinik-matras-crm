-- Simplifikasi Production slice 2 (flow adaptasi) — ADITIF: tidak ada DROP/UPDATE/DELETE; baris lama tidak berubah (kolom baru NULL = perilaku lama).
--
-- 1) production_runs_v2.adaptation_policy: kebijakan adaptasi EKSPLISIT yang tercatat pada run (NULL = proses lengkap lama; "ADAPTATION_V1" = QC/penerimaan barang jadi tidak wajib).
--    Histori & KPI membedakan proses lengkap, tahap dilewati, dan QC tidak dilakukan dari kolom ini + bukti tahap SKIPPED + fase QC NOT_APPLICABLE.
ALTER TABLE "production_runs_v2" ADD COLUMN "adaptation_policy" VARCHAR(40);

-- 2) production_operation_runs_v2.delay_kind/delay_note: alasan Tunda Pekerjaan pada pekerjaan di papan (ARAHAN/KENDALA/LAINNYA; BAHAN tetap lewat laporan kekurangan bahan).
ALTER TABLE "production_operation_runs_v2" ADD COLUMN "delay_kind" VARCHAR(20), ADD COLUMN "delay_note" TEXT;

-- 3) production_settings: pengaturan Admin Production (lokasi workshop bawaan, kebijakan adaptasi bawaan untuk run baru). Satu baris per kunci.
CREATE TABLE "production_settings" (
    "key"           VARCHAR(80) NOT NULL,
    "value"         JSONB       NOT NULL DEFAULT '{}'::jsonb,
    "updated_by_id" TEXT,
    "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_settings_pkey" PRIMARY KEY ("key")
);
