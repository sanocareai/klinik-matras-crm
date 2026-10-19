-- ADOPSI ADMIN (Okt 2026): status kerja manual + rencana bahan per unit. ADITIF: hanya CREATE TABLE/INDEX/FUNCTION/TRIGGER baru; tidak mengubah tabel atau data yang ada.
-- Tidak ada tulisan ke stock_movements / reservasi / jurnal / tahap / QC dari tabel-tabel ini.

CREATE TABLE "production_unit_work_progress" (
  "id" UUID NOT NULL,
  "unit_id" UUID NOT NULL,
  "status" TEXT NOT NULL,
  "note" TEXT,
  "actor_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "production_unit_work_progress_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "production_unit_work_progress_status_chk" CHECK ("status" IN ('BELUM_DIJADWALKAN','DIJADWALKAN','DIKERJAKAN','TERTUNDA','SELESAI'))
);
CREATE INDEX "production_unit_work_progress_unit_id_created_at_idx" ON "production_unit_work_progress"("unit_id", "created_at");
ALTER TABLE "production_unit_work_progress" ADD CONSTRAINT "production_unit_work_progress_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "production_unit_material_plans" (
  "id" UUID NOT NULL,
  "unit_id" UUID NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "lines" JSONB NOT NULL,
  "created_by_id" TEXT,
  "updated_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "production_unit_material_plans_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "production_unit_material_plans_lines_array_chk" CHECK (jsonb_typeof("lines") = 'array')
);
CREATE UNIQUE INDEX "production_unit_material_plans_unit_id_key" ON "production_unit_material_plans"("unit_id");
ALTER TABLE "production_unit_material_plans" ADD CONSTRAINT "production_unit_material_plans_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "production_unit_material_plan_revisions" (
  "id" UUID NOT NULL,
  "plan_id" UUID NOT NULL,
  "revision" INTEGER NOT NULL,
  "lines" JSONB NOT NULL,
  "reason" TEXT,
  "actor_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "production_unit_material_plan_revisions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "production_unit_material_plan_revisions_plan_id_revision_key" ON "production_unit_material_plan_revisions"("plan_id", "revision");
ALTER TABLE "production_unit_material_plan_revisions" ADD CONSTRAINT "production_unit_material_plan_revisions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "production_unit_material_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Append-only: riwayat status kerja dan revisi rencana tidak boleh diubah/dihapus (jejak audit).
CREATE OR REPLACE FUNCTION production_adopsi_append_only() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '% bersifat append-only (% ditolak)', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "production_unit_work_progress_append_only_trg" BEFORE UPDATE OR DELETE ON "production_unit_work_progress"
FOR EACH ROW EXECUTE FUNCTION production_adopsi_append_only();
CREATE TRIGGER "production_unit_material_plan_revisions_append_only_trg" BEFORE UPDATE OR DELETE ON "production_unit_material_plan_revisions"
FOR EACH ROW EXECUTE FUNCTION production_adopsi_append_only();
