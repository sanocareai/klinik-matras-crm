-- Warehouse Tahap 4 — lokasi penyimpanan nyata + Stock Transfer.
--
-- KENAPA. stock_movements.location (sejak v1) sengaja string bebas
-- berdefault "GUDANG_UTAMA" — cukup selama tidak ada fitur yang benar-benar
-- butuh MEMBANDINGKAN dua lokasi. Stock Transfer butuh itu, jadi string
-- bebas tidak lagi cukup.
--
-- DUA BARIS LEDGER PER TRANSFER, DUA LANGKAH: Confirm Dispatch menulis
-- movement TRANSFER negatif di lokasi asal; Confirm Receipt menulis movement
-- TRANSFER positif di lokasi tujuan (qty BISA beda — itu `difference` yang
-- diminta spesifikasi). Konsekuensi jujur: saldo total material se-gudang
-- turun sementara selama status IN_TRANSIT — barang di perjalanan memang
-- tidak bisa dialokasikan ke mana pun sampai benar-benar tiba.
--
-- SEED: satu Warehouse (WH-JKT) + satu StorageLocation per LocationType
-- (8 baris) — DATA NYATA operasional, BUKAN "Contoh", supaya Transfer
-- langsung bisa dipakai tanpa halaman manajemen lokasi terpisah (di luar
-- cakupan tahap ini). Menambah rack/bin granular menyusul kalau kebutuhan
-- nyatanya muncul — pola gen_random_uuid() sama dengan seed routing_stages
-- di migrasi 20260731100200.
--
-- AMAN SEKARANG: stock_movements masih KOSONG di production.

ALTER TYPE "StockMovementType" ADD VALUE 'TRANSFER';

CREATE TYPE "LocationType" AS ENUM (
  'RECEIVING_AREA', 'RAW_MATERIAL_AREA', 'WIP_AREA', 'FINISHED_GOODS_AREA',
  'QUARANTINE_AREA', 'DAMAGED_AREA', 'RETURN_AREA', 'DISPATCH_AREA'
);

CREATE TABLE "warehouses" (
    "id"         UUID NOT NULL,
    "code"       TEXT NOT NULL,
    "name"       TEXT NOT NULL,
    "address"    TEXT,
    "active"     BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "warehouses_code_key" ON "warehouses"("code");

CREATE TABLE "storage_locations" (
    "id"            UUID NOT NULL,
    "warehouse_id"  UUID NOT NULL,
    "zone"          TEXT NOT NULL,
    "rack"          TEXT,
    "bin"           TEXT,
    "location_type" "LocationType" NOT NULL,
    "active"        BOOLEAN NOT NULL DEFAULT true,
    "code"          TEXT NOT NULL,
    "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "storage_locations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "storage_locations_code_key" ON "storage_locations"("code");
CREATE INDEX "storage_locations_warehouse_id_idx" ON "storage_locations"("warehouse_id");
ALTER TABLE "storage_locations" ADD CONSTRAINT "storage_locations_warehouse_id_fkey"
    FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TYPE "TransferType" AS ENUM (
  'BIN_TO_BIN', 'ZONE_TO_ZONE', 'WAREHOUSE_TO_WAREHOUSE', 'AVAILABLE_TO_QUARANTINE',
  'QUARANTINE_TO_AVAILABLE', 'AVAILABLE_TO_DAMAGED', 'RETURN_TO_WAREHOUSE'
);

CREATE TYPE "TransferStatus" AS ENUM (
  'DRAFT', 'WAITING_APPROVAL', 'APPROVED', 'PICKED', 'IN_TRANSIT', 'COMPLETED', 'CANCELLED'
);

CREATE TABLE "stock_transfers" (
    "id"                      UUID NOT NULL,
    "transfer_number"         TEXT NOT NULL,
    "transfer_type"           "TransferType" NOT NULL,
    "source_location_id"      UUID NOT NULL,
    "destination_location_id" UUID NOT NULL,
    "status"                  "TransferStatus" NOT NULL DEFAULT 'DRAFT',
    "requested_by"            TEXT,
    "approved_by"             TEXT,
    "approved_at"             TIMESTAMP(3),
    "dispatched_at"           TIMESTAMP(3),
    "received_at"             TIMESTAMP(3),
    "notes"                   TEXT,
    "created_at"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"               TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_transfers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "stock_transfers_transfer_number_key" ON "stock_transfers"("transfer_number");
CREATE INDEX "stock_transfers_status_idx" ON "stock_transfers"("status");

ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_source_location_id_fkey"
    FOREIGN KEY ("source_location_id") REFERENCES "storage_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_destination_location_id_fkey"
    FOREIGN KEY ("destination_location_id") REFERENCES "storage_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_requested_by_fkey"
    FOREIGN KEY ("requested_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_approved_by_fkey"
    FOREIGN KEY ("approved_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "stock_transfer_lines" (
    "id"                UUID NOT NULL,
    "stock_transfer_id" UUID NOT NULL,
    "material_id"       UUID NOT NULL,
    "qty_sent"          DOUBLE PRECISION NOT NULL,
    "qty_received"      DOUBLE PRECISION,
    "notes"             TEXT,

    CONSTRAINT "stock_transfer_lines_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "stock_transfer_lines_stock_transfer_id_idx" ON "stock_transfer_lines"("stock_transfer_id");
CREATE INDEX "stock_transfer_lines_material_id_idx" ON "stock_transfer_lines"("material_id");
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_stock_transfer_id_fkey"
    FOREIGN KEY ("stock_transfer_id") REFERENCES "stock_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_material_id_fkey"
    FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_movements" ADD COLUMN "stock_transfer_id" UUID;
CREATE INDEX "stock_movements_stock_transfer_id_idx" ON "stock_movements"("stock_transfer_id");
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_stock_transfer_id_fkey"
    FOREIGN KEY ("stock_transfer_id") REFERENCES "stock_transfers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed: satu warehouse + satu lokasi per tipe (8 baris). Data operasional
-- nyata, dibuat sekali supaya Transfer punya lokasi valid untuk dipakai.
INSERT INTO "warehouses" ("id", "code", "name", "address")
VALUES (gen_random_uuid(), 'WH-JKT', 'Gudang Jakarta', NULL);

INSERT INTO "storage_locations" ("id", "warehouse_id", "zone", "location_type", "code")
SELECT gen_random_uuid(), w.id, z.zone, z.location_type::"LocationType", z.zone
FROM "warehouses" w,
  (VALUES
    ('RECEIVING',     'RECEIVING_AREA'),
    ('RAW-MATERIAL',  'RAW_MATERIAL_AREA'),
    ('WIP',           'WIP_AREA'),
    ('FINISHED-GOODS','FINISHED_GOODS_AREA'),
    ('QUARANTINE',    'QUARANTINE_AREA'),
    ('DAMAGED',       'DAMAGED_AREA'),
    ('RETURN',        'RETURN_AREA'),
    ('DISPATCH',      'DISPATCH_AREA')
  ) AS z(zone, location_type)
WHERE w.code = 'WH-JKT';
