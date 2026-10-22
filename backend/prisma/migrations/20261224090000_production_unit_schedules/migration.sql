-- RENCANA ADMIN (Okt 2026): jadwal produksi per UNIT tanpa Production Run (tanpa aktivasi V2). ADITIF: hanya CREATE TABLE/INDEX/TRIGGER baru.
-- Satu baris per unit (UNIQUE unit_id) = SATU sumber kebenaran tanggal+meja untuk unit yang belum dimiliki V2. Target selesai dan prioritas TETAP di units (productionDueAt, priority) — tidak diduplikasi di sini.
-- PIC meja = production_station_day_pics_v2 (sudah ada). status: ACTIVE (tampil di kalender) | CLEARED (dikeluarkan dari jadwal) | ADOPTED (diambil alih rencana V2 saat unit diaktifkan; sumber kebenaran pindah ke production_run_plans_v2).
-- TIDAK menulis production_runs_v2 / tahap / QC / custody / penerimaan / stok / jurnal / pesan.

CREATE TABLE "production_unit_schedules" (
  "id" UUID NOT NULL,
  "unit_id" UUID NOT NULL,
  "production_date" DATE NOT NULL,
  "station_code" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "adopted_plan_id" UUID,
  "created_by_id" TEXT,
  "updated_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "production_unit_schedules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "production_unit_schedules_status_chk" CHECK ("status" IN ('ACTIVE','CLEARED','ADOPTED')),
  CONSTRAINT "production_unit_schedules_station_chk" CHECK ("station_code" IS NULL OR "station_code" ~ '^TABLE_[0-9]{1,2}$'),
  CONSTRAINT "production_unit_schedules_revision_chk" CHECK ("revision" >= 1)
);
CREATE UNIQUE INDEX "production_unit_schedules_unit_id_key" ON "production_unit_schedules"("unit_id");
CREATE INDEX "production_unit_schedules_production_date_station_code_idx" ON "production_unit_schedules"("production_date", "station_code");
ALTER TABLE "production_unit_schedules" ADD CONSTRAINT "production_unit_schedules_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_unit_schedules" ADD CONSTRAINT "production_unit_schedules_adopted_plan_id_fkey" FOREIGN KEY ("adopted_plan_id") REFERENCES "production_run_plans_v2"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RIWAYAT jadwal Admin (append-only; fungsi trigger yang sama dengan tabel adopsi lain, dibuat migrasi 20261221090000). Nilai lama + baru, pelaku, alasan; UNDONE menunjuk event yang dibatalkan.
CREATE TABLE "production_unit_schedule_events" (
  "id" UUID NOT NULL,
  "schedule_id" UUID NOT NULL,
  "unit_id" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "from_date" DATE,
  "from_station" TEXT,
  "from_priority" TEXT,
  "from_target_at" TIMESTAMP(3),
  "to_date" DATE,
  "to_station" TEXT,
  "to_priority" TEXT,
  "to_target_at" TIMESTAMP(3),
  "note" TEXT,
  "undo_of_event_id" UUID,
  "resulting_revision" INTEGER NOT NULL,
  "idempotency_key" TEXT,
  "actor_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "production_unit_schedule_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "production_unit_schedule_events_kind_chk" CHECK ("kind" IN ('SCHEDULED','RESCHEDULED','UNSCHEDULED','TARGET_CHANGED','UNDONE','ADOPTED'))
);
CREATE INDEX "production_unit_schedule_events_schedule_id_created_at_idx" ON "production_unit_schedule_events"("schedule_id", "created_at");
CREATE INDEX "production_unit_schedule_events_unit_id_created_at_idx" ON "production_unit_schedule_events"("unit_id", "created_at");
CREATE UNIQUE INDEX "production_unit_schedule_events_unit_id_idempotency_key_key" ON "production_unit_schedule_events"("unit_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL;
ALTER TABLE "production_unit_schedule_events" ADD CONSTRAINT "production_unit_schedule_events_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "production_unit_schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_unit_schedule_events" ADD CONSTRAINT "production_unit_schedule_events_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TRIGGER "production_unit_schedule_events_append_only_trg" BEFORE UPDATE OR DELETE ON "production_unit_schedule_events"
FOR EACH ROW EXECUTE FUNCTION production_adopsi_append_only();
