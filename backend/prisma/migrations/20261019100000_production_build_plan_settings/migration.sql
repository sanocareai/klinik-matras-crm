-- Jalur Pengerjaan Pesanan (BARU/custom) — pengaturan per Run + catatan racikan/pemakaian bahan (ADITIF; tanpa DROP/UPDATE/DELETE).
--  1) production_run_build_settings_v2: SATU baris per Run — PIC Bahan per pekerjaan (operator produksi yang sah) dan kebutuhan Corner yang dikonfirmasi pada rencana
--     (corner_required NULL = belum dikonfirmasi; FALSE wajib beralasan). Bukan peran/akun baru.
--  2) production_build_material_records_v2: catatan racikan + pemakaian aktual oleh PIC Bahan. Append-only (versi baru menggantikan yang lama saat dibaca); tidak menulis stok —
--     stok keluar HANYA terjadi saat Gudang menyerahkan bahan (Material Issue P4).
CREATE TABLE "production_run_build_settings_v2" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "run_id" UUID NOT NULL,
  "material_operator_id" UUID,
  "corner_required" BOOLEAN,
  "corner_reason" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "updated_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "production_run_build_settings_v2_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "production_run_build_settings_v2_corner_reason_check" CHECK ("corner_required" IS DISTINCT FROM FALSE OR length(btrim(coalesce("corner_reason", ''))) >= 3)
);
CREATE UNIQUE INDEX "production_run_build_settings_v2_run_id_key" ON "production_run_build_settings_v2"("run_id");
CREATE INDEX "production_run_build_settings_v2_material_operator_id_idx" ON "production_run_build_settings_v2"("material_operator_id");
ALTER TABLE "production_run_build_settings_v2" ADD CONSTRAINT "production_run_build_settings_v2_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "production_runs_v2"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_run_build_settings_v2" ADD CONSTRAINT "production_run_build_settings_v2_material_operator_id_fkey" FOREIGN KEY ("material_operator_id") REFERENCES "production_operators"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "production_build_material_records_v2" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "run_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "actor_id" TEXT,
  "racikan" JSONB,
  "materials" JSONB NOT NULL DEFAULT '[]',
  "note" TEXT,
  "command_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "production_build_material_records_v2_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "production_build_material_records_v2_run_id_version_key" ON "production_build_material_records_v2"("run_id", "version");
ALTER TABLE "production_build_material_records_v2" ADD CONSTRAINT "production_build_material_records_v2_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "production_runs_v2"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "production_build_material_records_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Catatan racikan/pemakaian bahan (%) bersifat append-only: hanya INSERT yang diizinkan', TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation';
END;
$$;
CREATE TRIGGER "production_build_material_records_v2_immutable" BEFORE UPDATE OR DELETE ON "production_build_material_records_v2"
  FOR EACH ROW EXECUTE FUNCTION "production_build_material_records_immutable"();
