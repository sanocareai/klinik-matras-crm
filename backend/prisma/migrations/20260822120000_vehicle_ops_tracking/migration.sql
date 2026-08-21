-- D-035 — Armada: detail & dokumen kendaraan, biaya operasional, riwayat
-- servis, catatan insiden. Lihat komentar panjang di schema.prisma.

CREATE TYPE "ExpenseCategory" AS ENUM ('BBM', 'TOL', 'PARKIR', 'CUCI', 'DENDA', 'LAINNYA');
CREATE TYPE "ServiceType" AS ENUM ('RUTIN', 'PERBAIKAN', 'GANTI_OLI', 'GANTI_BAN', 'BODY_REPAIR', 'LAINNYA');
CREATE TYPE "IncidentType" AS ENUM ('KECELAKAAN', 'LECET', 'MOGOK', 'TILANG', 'LAINNYA');
CREATE TYPE "IncidentSeverity" AS ENUM ('RINGAN', 'SEDANG', 'BERAT');
CREATE TYPE "FaultParty" AS ENUM ('DRIVER_KITA', 'PIHAK_LAIN', 'TIDAK_JELAS');
CREATE TYPE "ClaimStatus" AS ENUM ('TIDAK_DIKLAIM', 'DIAJUKAN', 'DISETUJUI', 'DITOLAK');

-- Kolom baru di vehicles — SEMUA nullable supaya kendaraan yang sudah
-- terdaftar tidak mendadak invalid.
ALTER TABLE "vehicles"
  ADD COLUMN "brand" TEXT,
  ADD COLUMN "model" TEXT,
  ADD COLUMN "year" INTEGER,
  ADD COLUMN "color" TEXT,
  ADD COLUMN "chassis_number" TEXT,
  ADD COLUMN "engine_number" TEXT,
  ADD COLUMN "stnk_number" TEXT,
  ADD COLUMN "stnk_expiry" DATE,
  ADD COLUMN "tax_expiry" DATE,
  ADD COLUMN "kir_expiry" DATE,
  ADD COLUMN "insurance_policy" TEXT,
  ADD COLUMN "insurance_expiry" DATE,
  ADD COLUMN "pic_driver_id" TEXT;

ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_pic_driver_id_fkey"
  FOREIGN KEY ("pic_driver_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "vehicles_pic_driver_id_idx" ON "vehicles"("pic_driver_id");

CREATE TABLE "vehicle_expenses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "vehicle_id" UUID NOT NULL,
    "driver_id" TEXT,
    "date" DATE NOT NULL,
    "category" "ExpenseCategory" NOT NULL,
    "amount" INTEGER NOT NULL,
    "odometer_km" INTEGER,
    "liters" DOUBLE PRECISION,
    "receipt_url" TEXT,
    "notes" TEXT,
    "route_id" UUID,
    "recorded_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "vehicle_expenses_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "vehicle_expenses_vehicle_id_date_idx" ON "vehicle_expenses"("vehicle_id", "date");
CREATE INDEX "vehicle_expenses_driver_id_date_idx" ON "vehicle_expenses"("driver_id", "date");
CREATE INDEX "vehicle_expenses_category_date_idx" ON "vehicle_expenses"("category", "date");
ALTER TABLE "vehicle_expenses" ADD CONSTRAINT "vehicle_expenses_vehicle_id_fkey"
  FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vehicle_expenses" ADD CONSTRAINT "vehicle_expenses_driver_id_fkey"
  FOREIGN KEY ("driver_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "vehicle_expenses" ADD CONSTRAINT "vehicle_expenses_route_id_fkey"
  FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "vehicle_expenses" ADD CONSTRAINT "vehicle_expenses_recorded_by_id_fkey"
  FOREIGN KEY ("recorded_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "vehicle_services" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "vehicle_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "type" "ServiceType" NOT NULL,
    "odometer_km" INTEGER NOT NULL,
    "cost" INTEGER NOT NULL,
    "workshop" TEXT,
    "description" TEXT,
    "receipt_url" TEXT,
    "next_service_km" INTEGER,
    "next_service_date" DATE,
    "recorded_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "vehicle_services_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "vehicle_services_vehicle_id_date_idx" ON "vehicle_services"("vehicle_id", "date");
ALTER TABLE "vehicle_services" ADD CONSTRAINT "vehicle_services_vehicle_id_fkey"
  FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vehicle_services" ADD CONSTRAINT "vehicle_services_recorded_by_id_fkey"
  FOREIGN KEY ("recorded_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "vehicle_incidents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "vehicle_id" UUID NOT NULL,
    "driver_id" TEXT,
    "driver_name" TEXT,
    "date" DATE NOT NULL,
    "type" "IncidentType" NOT NULL,
    "severity" "IncidentSeverity" NOT NULL,
    "description" TEXT NOT NULL,
    "photo_urls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "location" TEXT,
    "repair_cost" INTEGER,
    "fault_party" "FaultParty" NOT NULL DEFAULT 'TIDAK_JELAS',
    "insurance_claim" "ClaimStatus" NOT NULL DEFAULT 'TIDAK_DIKLAIM',
    "downtime_days" INTEGER,
    "resolved_at" DATE,
    "recorded_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "vehicle_incidents_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "vehicle_incidents_vehicle_id_date_idx" ON "vehicle_incidents"("vehicle_id", "date");
CREATE INDEX "vehicle_incidents_driver_id_date_idx" ON "vehicle_incidents"("driver_id", "date");
ALTER TABLE "vehicle_incidents" ADD CONSTRAINT "vehicle_incidents_vehicle_id_fkey"
  FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vehicle_incidents" ADD CONSTRAINT "vehicle_incidents_driver_id_fkey"
  FOREIGN KEY ("driver_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "vehicle_incidents" ADD CONSTRAINT "vehicle_incidents_recorded_by_id_fkey"
  FOREIGN KEY ("recorded_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
