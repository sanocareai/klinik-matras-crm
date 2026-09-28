-- Production Workshop + Warehouse V2 P6: QC V2 (PASS/FAIL/WAIVED), custody barang jadi (FINISHED_GOODS), bahan tambahan rework,
-- exception rekonsiliasi override V1. ADITIF: enum value baru, kolom nullable, tabel baru, trigger immutability, CHECK baru. Satu-satunya
-- perubahan pada objek lama: (a) delivery_job_id dilonggarkan jadi NULLABLE (dijaga CHECK: hanya FINISHED_GOODS yang boleh NULL, INBOUND/RETURN tetap
-- wajib punya Job) dan (b) partial unique index planned_bom_lines_v2_active_material_key dibuat ulang agar baris BOM TAMBAHAN rework boleh
-- berdampingan dengan baris BOM asli untuk material yang sama. Tidak ada DROP TABLE/COLUMN, UPDATE, atau DELETE data.

-- 1. Custody barang jadi memakai model custody yang sama.
ALTER TYPE "UnitCustodyDirection" ADD VALUE 'FINISHED_GOODS';

ALTER TABLE "unit_custody_handoffs_v2" ALTER COLUMN "delivery_job_id" DROP NOT NULL;

-- NULL <=> FINISHED_GOODS (dibandingkan sebagai teks: nilai enum baru tidak boleh dipakai di transaksi yang menambahkannya).
ALTER TABLE "unit_custody_handoffs_v2" ADD CONSTRAINT "unit_custody_handoffs_v2_job_by_direction_chk"
  CHECK (("direction"::text = 'FINISHED_GOODS') = ("delivery_job_id" IS NULL));

-- 2. QC V2: tautan ke proyeksi qc_fit_tests V1 + inspeksi IMMUTABLE (hanya INSERT).
ALTER TABLE "quality_inspections_v2" ADD COLUMN "qc_fit_test_id" UUID;

ALTER TABLE "quality_inspections_v2" ADD CONSTRAINT "quality_inspections_v2_qc_fit_test_id_fkey"
  FOREIGN KEY ("qc_fit_test_id") REFERENCES "qc_fit_tests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "quality_inspections_v2_qc_fit_test_id_idx" ON "quality_inspections_v2"("qc_fit_test_id");

CREATE FUNCTION "quality_inspection_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Inspeksi QC (%) bersifat immutable: hanya INSERT yang diizinkan', TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE TRIGGER "quality_inspections_v2_immutable" BEFORE UPDATE OR DELETE ON "quality_inspections_v2"
  FOR EACH ROW EXECUTE FUNCTION "quality_inspection_immutable"();

CREATE TRIGGER "quality_inspection_items_v2_immutable" BEFORE UPDATE OR DELETE ON "quality_inspection_items_v2"
  FOR EACH ROW EXECUTE FUNCTION "quality_inspection_immutable"();

-- 3. Bahan tambahan rework (supplemental): baris BOM/issue terhubung ke inspeksi QC yang gagal; reservasi asli tidak pernah dibuka lagi.
ALTER TABLE "planned_bom_lines_v2" ADD COLUMN "supplemental_inspection_id" UUID;
ALTER TABLE "material_issues" ADD COLUMN "rework_inspection_id" UUID;

ALTER TABLE "planned_bom_lines_v2" ADD CONSTRAINT "planned_bom_lines_v2_supplemental_inspection_id_fkey"
  FOREIGN KEY ("supplemental_inspection_id") REFERENCES "quality_inspections_v2"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "material_issues" ADD CONSTRAINT "material_issues_rework_inspection_id_fkey"
  FOREIGN KEY ("rework_inspection_id") REFERENCES "quality_inspections_v2"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "planned_bom_lines_v2_supplemental_inspection_id_idx" ON "planned_bom_lines_v2"("supplemental_inspection_id");
CREATE INDEX "material_issues_rework_inspection_id_idx" ON "material_issues"("rework_inspection_id");

-- Satu BOM aktif per (plan, material) UNTUK baris asli; baris tambahan diberi ruang per inspeksi (COALESCE ke UUID nol untuk baris asli).
DROP INDEX "planned_bom_lines_v2_active_material_key";
CREATE UNIQUE INDEX "planned_bom_lines_v2_active_material_key" ON "planned_bom_lines_v2"
  ("plan_id", "material_id", COALESCE("supplemental_inspection_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "status" = 'ACTIVE';

-- Satu permintaan bahan tambahan (belum dibatalkan) per inspeksi gagal.
CREATE UNIQUE INDEX "material_issues_active_rework_key" ON "material_issues"("rework_inspection_id")
  WHERE "rework_inspection_id" IS NOT NULL AND "status" <> 'CANCELLED';

-- 4. Exception rekonsiliasi override V1.
CREATE TYPE "ProductionRunExceptionKind" AS ENUM ('UNIT_CANCELLED', 'UNIT_MARKED_READY', 'UNIT_SHIPPED');
CREATE TYPE "ProductionRunExceptionStatus" AS ENUM ('OPEN', 'RESOLVED');
CREATE TYPE "ProductionRunExceptionResolution" AS ENUM ('RESTORE_UNIT_STATUS', 'CANCEL_RUN', 'ACCEPT_OVERRIDE', 'NO_LONGER_APPLICABLE');

CREATE TABLE "production_run_exceptions_v2" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "kind" "ProductionRunExceptionKind" NOT NULL,
    "status" "ProductionRunExceptionStatus" NOT NULL DEFAULT 'OPEN',
    "unit_status_seen" TEXT NOT NULL,
    "run_phase_seen" TEXT,
    "run_revision_seen" INTEGER NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "detected_by_id" TEXT,
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolution" "ProductionRunExceptionResolution",
    "resolution_note" TEXT,
    "resolved_by_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 1,
    "command_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_run_exceptions_v2_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "production_run_exceptions_v2_status_detected_at_idx" ON "production_run_exceptions_v2"("status", "detected_at");
CREATE INDEX "production_run_exceptions_v2_run_id_status_idx" ON "production_run_exceptions_v2"("run_id", "status");

ALTER TABLE "production_run_exceptions_v2" ADD CONSTRAINT "production_run_exceptions_v2_run_id_fkey"
  FOREIGN KEY ("run_id") REFERENCES "production_runs_v2"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_run_exceptions_v2" ADD CONSTRAINT "production_run_exceptions_v2_unit_id_fkey"
  FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Satu exception OPEN per Production Run.
CREATE UNIQUE INDEX "production_run_exceptions_v2_open_run_key" ON "production_run_exceptions_v2"("run_id") WHERE "status" = 'OPEN';
