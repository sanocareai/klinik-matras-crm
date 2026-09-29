-- Production Experience V2 (P8): papan meja Planner, bukti 12 tahap PIC Table/Corner, laporan kekurangan bahan.
-- ADITIF: kolom nullable/berdefault pada production_run_plans_v2, dua tabel baru, satu enum baru, satu trigger immutability.
-- Tidak ada DROP, UPDATE, DELETE, atau perubahan tipe kolom lama. Baris plan lama tetap valid (kolom baru NULL / priority 0).

-- 1. Papan meja (P3 tetap satu-satunya penulis production_run_plans_v2): tanggal produksi, meja bongkar, prioritas, dan
--    penugasan Corner (PIC jahit) yang berbeda dari PIC meja.
ALTER TABLE "production_run_plans_v2" ADD COLUMN "production_date" DATE;
ALTER TABLE "production_run_plans_v2" ADD COLUMN "station_code" TEXT;
ALTER TABLE "production_run_plans_v2" ADD COLUMN "priority" SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE "production_run_plans_v2" ADD COLUMN "corner_work_center_id" UUID;
ALTER TABLE "production_run_plans_v2" ADD COLUMN "corner_operator_id" UUID;

ALTER TABLE "production_run_plans_v2" ADD CONSTRAINT "production_run_plans_v2_priority_chk" CHECK ("priority" BETWEEN 0 AND 2);
ALTER TABLE "production_run_plans_v2" ADD CONSTRAINT "production_run_plans_v2_station_code_chk"
  CHECK ("station_code" IS NULL OR "station_code" ~ '^TABLE_[0-9]{1,2}$');
-- Meja hanya bermakna bersama tanggal produksi.
ALTER TABLE "production_run_plans_v2" ADD CONSTRAINT "production_run_plans_v2_station_date_chk"
  CHECK ("station_code" IS NULL OR "production_date" IS NOT NULL);

ALTER TABLE "production_run_plans_v2" ADD CONSTRAINT "production_run_plans_v2_corner_work_center_id_fkey"
  FOREIGN KEY ("corner_work_center_id") REFERENCES "work_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "production_run_plans_v2" ADD CONSTRAINT "production_run_plans_v2_corner_operator_id_fkey"
  FOREIGN KEY ("corner_operator_id") REFERENCES "production_operators"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "production_run_plans_v2_production_date_station_code_idx" ON "production_run_plans_v2"("production_date", "station_code");
CREATE INDEX "production_run_plans_v2_corner_operator_id_idx" ON "production_run_plans_v2"("corner_operator_id");

-- 2. Bukti tahap (evidence-gated) — IMMUTABLE: hanya INSERT. Versi naik per (run, tahap) untuk pengulangan/rework; histori tidak pernah diubah.
CREATE TABLE "production_step_evidence_v2" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "operation_run_id" UUID,
    "stage_id" UUID,
    "step_no" SMALLINT NOT NULL,
    "step_code" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "media" JSONB NOT NULL DEFAULT '[]',
    "actor_id" TEXT,
    "command_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_step_evidence_v2_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "production_step_evidence_v2_step_no_chk" CHECK ("step_no" BETWEEN 1 AND 12),
    CONSTRAINT "production_step_evidence_v2_version_chk" CHECK ("version" >= 1)
);

CREATE UNIQUE INDEX "production_step_evidence_v2_run_id_step_no_version_key" ON "production_step_evidence_v2"("run_id", "step_no", "version");
CREATE INDEX "production_step_evidence_v2_run_id_created_at_idx" ON "production_step_evidence_v2"("run_id", "created_at");
CREATE INDEX "production_step_evidence_v2_operation_run_id_idx" ON "production_step_evidence_v2"("operation_run_id");

ALTER TABLE "production_step_evidence_v2" ADD CONSTRAINT "production_step_evidence_v2_run_id_fkey"
  FOREIGN KEY ("run_id") REFERENCES "production_runs_v2"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_step_evidence_v2" ADD CONSTRAINT "production_step_evidence_v2_operation_run_id_fkey"
  FOREIGN KEY ("operation_run_id") REFERENCES "production_operation_runs_v2"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_step_evidence_v2" ADD CONSTRAINT "production_step_evidence_v2_stage_id_fkey"
  FOREIGN KEY ("stage_id") REFERENCES "routing_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_step_evidence_v2" ADD CONSTRAINT "production_step_evidence_v2_command_id_fkey"
  FOREIGN KEY ("command_id") REFERENCES "v2_commands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "production_step_evidence_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Bukti tahap produksi (%) bersifat immutable: hanya INSERT yang diizinkan', TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE TRIGGER "production_step_evidence_v2_immutable" BEFORE UPDATE OR DELETE ON "production_step_evidence_v2"
  FOR EACH ROW EXECUTE FUNCTION "production_step_evidence_immutable"();

-- 3. Kekurangan bahan ("Menunggu Bahan Baku") — satu OPEN per run; diselesaikan Gudang, histori tetap.
CREATE TYPE "ProductionMaterialShortageStatus" AS ENUM ('OPEN', 'RESOLVED', 'CANCELLED');

CREATE TABLE "production_material_shortages_v2" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "operation_run_id" UUID,
    "status" "ProductionMaterialShortageStatus" NOT NULL DEFAULT 'OPEN',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "items" JSONB NOT NULL DEFAULT '[]',
    "note" TEXT,
    "reported_by_id" TEXT,
    "reported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_by_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "resolution_note" TEXT,
    "command_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_material_shortages_v2_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "production_material_shortages_v2_open_run_key" ON "production_material_shortages_v2"("run_id") WHERE "status" = 'OPEN';
CREATE INDEX "production_material_shortages_v2_status_reported_at_idx" ON "production_material_shortages_v2"("status", "reported_at");
CREATE INDEX "production_material_shortages_v2_unit_id_idx" ON "production_material_shortages_v2"("unit_id");

ALTER TABLE "production_material_shortages_v2" ADD CONSTRAINT "production_material_shortages_v2_run_id_fkey"
  FOREIGN KEY ("run_id") REFERENCES "production_runs_v2"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_material_shortages_v2" ADD CONSTRAINT "production_material_shortages_v2_unit_id_fkey"
  FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_material_shortages_v2" ADD CONSTRAINT "production_material_shortages_v2_operation_run_id_fkey"
  FOREIGN KEY ("operation_run_id") REFERENCES "production_operation_runs_v2"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_material_shortages_v2" ADD CONSTRAINT "production_material_shortages_v2_command_id_fkey"
  FOREIGN KEY ("command_id") REFERENCES "v2_commands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
