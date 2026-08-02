-- Delivery Tahap 3 (fondasi) — entitas Vehicle & Route.
--
-- KENAPA SEKARANG. Sebelum ini kendaraan tidak ada sama sekali di sistem, dan
-- "rute" hanya implisit: sekumpulan job dengan driver+tanggal+tipe yang sama,
-- diurutkan kolom `sequence`. Bentuk itu tidak bisa menyimpan STATUS, padahal
-- Route Planner butuh dispatcher menyusun DRAFT dulu lalu menerbitkannya.
--
-- AMAN DILAKUKAN SEKARANG, dan justru ini jendela termurahnya: tabel `jobs`
-- masih KOSONG (0 baris, diverifikasi langsung di production sebelum migrasi
-- ini ditulis). Tidak ada satu pun job historis yang kendaraannya harus
-- ditebak. Menunda sampai job sudah ratusan berarti menebak kendaraan untuk
-- data lama — dan tebakan itu akan masuk ke laporan utilisasi armada.
--
-- ADITIF MURNI: 2 tabel + 2 enum + 2 kolom NULLABLE di `jobs`. Tidak ada
-- kolom lama yang diubah artinya, tidak ada data yang disentuh, tidak ada
-- backfill. `jobs.driver_id` dan `jobs.sequence` TETAP berfungsi persis
-- seperti sebelumnya — query "job saya hari ini" milik driver tidak berubah.

-- CreateEnum
CREATE TYPE "VehicleStatus" AS ENUM ('AVAILABLE', 'IN_USE', 'MAINTENANCE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "RouteStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "vehicles" (
    "id"                UUID    NOT NULL,
    "plate_number"      TEXT    NOT NULL,
    "type"              TEXT    NOT NULL,
    "capacity_slots"    INTEGER NOT NULL,
    "status"            "VehicleStatus" NOT NULL DEFAULT 'AVAILABLE',
    "active"            BOOLEAN NOT NULL DEFAULT true,
    "mileage_km"        INTEGER,
    "next_service_date" DATE,
    "notes"             TEXT,
    "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"        TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vehicles_plate_number_key" ON "vehicles"("plate_number");
CREATE INDEX "vehicles_status_idx" ON "vehicles"("status");

-- CreateTable
CREATE TABLE "routes" (
    "id"                   UUID NOT NULL,
    "code"                 TEXT NOT NULL,
    "date"                 DATE NOT NULL,
    "driver_id"            TEXT,
    "vehicle_id"           UUID,
    "status"               "RouteStatus" NOT NULL DEFAULT 'DRAFT',
    "planned_distance_km"  DECIMAL(8,2),
    "planned_duration_min" INTEGER,
    "published_at"         TIMESTAMP(3),
    "notes"                TEXT,
    "created_by"           TEXT,
    "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"           TIMESTAMP(3) NOT NULL,

    CONSTRAINT "routes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "routes_code_key" ON "routes"("code");
CREATE INDEX "routes_date_status_idx"    ON "routes"("date", "status");
CREATE INDEX "routes_driver_id_date_idx" ON "routes"("driver_id", "date");

-- AlterTable — dua kolom NULLABLE, tidak mengunci tabel lama & tidak butuh default
ALTER TABLE "jobs" ADD COLUMN "vehicle_id" UUID;
ALTER TABLE "jobs" ADD COLUMN "route_id"   UUID;

CREATE INDEX "jobs_route_id_sequence_idx" ON "jobs"("route_id", "sequence");
CREATE INDEX "jobs_vehicle_id_idx"        ON "jobs"("vehicle_id");

-- SetNull di semua FK job→armada/rute: kendaraan dijual atau rute dibatalkan
-- TIDAK BOLEH menghapus job-nya. Job adalah catatan pekerjaan yang benar-benar
-- terjadi; kendaraan hanya keterangan tambahan padanya.
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_vehicle_id_fkey"
    FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_route_id_fkey"
    FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "routes" ADD CONSTRAINT "routes_vehicle_id_fkey"
    FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- SetNull untuk aktor: driver/dispatcher resign, riwayat rute TETAP ada —
-- pola yang sama dengan unit_stage_logs, stock_movements, dan scope_revisions.
ALTER TABLE "routes" ADD CONSTRAINT "routes_driver_id_fkey"
    FOREIGN KEY ("driver_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "routes" ADD CONSTRAINT "routes_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
