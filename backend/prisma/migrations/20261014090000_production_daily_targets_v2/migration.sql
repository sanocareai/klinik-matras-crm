-- P11.1 — target harian Produksi V2 tersimpan historis. ADITIF MURNI: satu tabel baru + trigger immutability.
-- Tidak ada DROP/UPDATE/DELETE/ALTER pada tabel lama; tabel kosong = laporan memakai konfigurasi sistem (perilaku P11 saat ini).
CREATE TABLE "production_daily_targets_v2" (
    "id" UUID NOT NULL,
    "effective_from" DATE NOT NULL,
    "target_units" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_daily_targets_v2_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "production_daily_targets_v2_target_units_chk" CHECK ("target_units" BETWEEN 1 AND 500),
    CONSTRAINT "production_daily_targets_v2_reason_chk" CHECK (char_length(btrim("reason")) BETWEEN 5 AND 300)
);

CREATE INDEX "production_daily_targets_v2_effective_from_created_at_idx" ON "production_daily_targets_v2"("effective_from", "created_at");

CREATE FUNCTION "production_daily_targets_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Target harian produksi (%) append-only: koreksi = baris baru, UPDATE/DELETE tidak diizinkan', TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE TRIGGER "production_daily_targets_v2_immutable" BEFORE UPDATE OR DELETE ON "production_daily_targets_v2"
  FOR EACH ROW EXECUTE FUNCTION "production_daily_targets_immutable"();
