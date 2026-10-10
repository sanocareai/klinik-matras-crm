-- Rencana Produksi: PIC bawaan per meja per tanggal, target pengecualian per kartu, dan riwayat jadwal/target append-only.
-- ADITIF MURNI: dua tabel baru + satu kolom nullable di production_run_plans_v2. Tidak ada DROP/DELETE/UPDATE pada data lama; NULL = perilaku saat ini
-- (target = tanggal papan, tidak ada PIC bawaan meja). Kolom baru tidak NOT NULL dan tanpa default yang mengubah baris lama.

-- 1. PIC bawaan per meja+tanggal (usulan penjadwalan; BUKAN penugasan unit)
CREATE TABLE "production_station_day_pics_v2" (
    "id" UUID NOT NULL,
    "production_date" DATE NOT NULL,
    "station_code" TEXT NOT NULL,
    "operator_id" UUID NOT NULL,
    "set_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_station_day_pics_v2_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "production_station_day_pics_v2_production_date_station_code_key"
  ON "production_station_day_pics_v2"("production_date", "station_code");

ALTER TABLE "production_station_day_pics_v2"
  ADD CONSTRAINT "production_station_day_pics_v2_operator_id_fkey"
  FOREIGN KEY ("operator_id") REFERENCES "production_operators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2. Target pengecualian per kartu (NULL = target bawaan = tanggal papan)
ALTER TABLE "production_run_plans_v2" ADD COLUMN "target_date" DATE;

-- 3. Riwayat jadwal/target (append-only)
CREATE TABLE "production_plan_schedule_events_v2" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "unit_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "from_date" DATE,
    "from_station" TEXT,
    "from_target_date" DATE,
    "to_date" DATE,
    "to_station" TEXT,
    "to_target_date" DATE,
    "missed_target" BOOLEAN NOT NULL DEFAULT false,
    "reason_code" TEXT,
    "note" TEXT,
    "actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_plan_schedule_events_v2_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "production_plan_schedule_events_v2_kind_chk" CHECK ("kind" IN ('SCHEDULED', 'RESCHEDULED', 'UNSCHEDULED', 'TARGET_CHANGED'))
);

CREATE INDEX "production_plan_schedule_events_v2_plan_id_created_at_idx" ON "production_plan_schedule_events_v2"("plan_id", "created_at");
CREATE INDEX "production_plan_schedule_events_v2_unit_id_created_at_idx" ON "production_plan_schedule_events_v2"("unit_id", "created_at");

ALTER TABLE "production_plan_schedule_events_v2"
  ADD CONSTRAINT "production_plan_schedule_events_v2_plan_id_fkey"
  FOREIGN KEY ("plan_id") REFERENCES "production_run_plans_v2"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "production_plan_schedule_events_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Riwayat jadwal produksi (%) append-only: UPDATE/DELETE tidak diizinkan', TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE TRIGGER "production_plan_schedule_events_v2_immutable" BEFORE UPDATE OR DELETE ON "production_plan_schedule_events_v2"
  FOR EACH ROW EXECUTE FUNCTION "production_plan_schedule_events_immutable"();
