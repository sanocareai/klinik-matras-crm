-- Production Core Slice 4 (10 September 2026) — fondasi Production Route /
-- Work Center / Operator. Lihat catatan arsitektur panjang di
-- schema.prisma (blok "SANSS PRODUCTION CORE — SLICE 4") untuk kenapa
-- model-model ini TIDAK menggantikan mesin routing live (ServiceCatalog/
-- ServiceCatalogModule/RoutingStage, D-003) — murni lapisan TERPISAH
-- (snapshot rute + staffing), engine eksekusi (unitStageEngine.js) SAMA
-- SEKALI TIDAK DISENTUH migrasi ini.
--
-- ADITIF MURNI — SEMUA operasi di bawah:
--   - CREATE TABLE (6 tabel baru, semua kosong di awal)
--   - ADD COLUMN nullable (units.production_route_id,
--     routing_stages.default_work_center_id) — operasi METADATA-ONLY di
--     Postgres 11+ untuk kolom nullable tanpa default non-null, TIDAK
--     mengunci/menulis ulang tabel yang sudah ada (units: 317 baris,
--     routing_stages: 12 baris per audit CLAUDE.md §19 — kecil, tapi
--     catatan ini berlaku juga untuk tabel jauh lebih besar)
-- Tidak ada kolom/tabel lama yang diubah tipe/dihapus/di-rename.
--
-- Rollback manual (urutan MUNDUR karena FK):
--   ALTER TABLE "units" DROP COLUMN "production_route_id";
--   ALTER TABLE "routing_stages" DROP COLUMN "default_work_center_id";
--   DROP TABLE "stage_assignments";
--   DROP TABLE "operator_skills";
--   DROP TABLE "production_operators";
--   DROP TABLE "production_route_stages";
--   DROP TABLE "production_routes";
--   DROP TABLE "work_centers";

-- AlterTable
ALTER TABLE "units" ADD COLUMN     "production_route_id" UUID;

-- AlterTable
ALTER TABLE "routing_stages" ADD COLUMN     "default_work_center_id" UUID;

-- CreateTable
CREATE TABLE "work_centers" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "standard_daily_minutes" INTEGER,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_centers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_routes" (
    "id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "service_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_route_stages" (
    "id" UUID NOT NULL,
    "route_id" UUID NOT NULL,
    "stage_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "work_center_id" UUID,
    "weight" INTEGER,
    "standard_duration_minutes" INTEGER,

    CONSTRAINT "production_route_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_operators" (
    "id" UUID NOT NULL,
    "user_id" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "primary_work_center_id" UUID,
    "employee_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_operators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operator_skills" (
    "id" UUID NOT NULL,
    "operator_id" UUID NOT NULL,
    "stage_id" UUID NOT NULL,
    "level" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "operator_skills_pkey" PRIMARY KEY ("id"),
    -- Level 1-5 (spec ticket Slice 4G) — dijaga di DATABASE, bukan cuma
    -- validasi aplikasi (pola sama dengan CHECK educationGiven/
    -- customerPreferenceOverride D-009 di qc_fit_tests).
    CONSTRAINT "operator_skills_level_check" CHECK ("level" BETWEEN 1 AND 5)
);

-- CreateTable
CREATE TABLE "stage_assignments" (
    "id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "stage_id" UUID NOT NULL,
    "work_center_id" UUID,
    "operator_id" UUID,
    "assigned_by" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stage_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "work_centers_code_key" ON "work_centers"("code");

-- CreateIndex
CREATE INDEX "production_routes_service_id_idx" ON "production_routes"("service_id");

-- CreateIndex
CREATE UNIQUE INDEX "production_routes_service_id_version_key" ON "production_routes"("service_id", "version");

-- Invarian "satu versi rute AKTIF per layanan" (lihat catatan arsitektur di
-- schema.prisma model ProductionRoute) — partial unique index, pola SAMA
-- dengan production_blockers_unit_id_open_key. Versi lama (active=false)
-- boleh menumpuk sebagai riwayat, tapi cuma SATU yang aktif per service
-- di satu waktu — mencegah race dua "publish versi baru" bersamaan diam-
-- diam menghasilkan dua rute aktif untuk layanan yang sama.
CREATE UNIQUE INDEX "production_routes_service_id_active_key"
  ON "production_routes" ("service_id")
  WHERE "active" = true;

-- CreateIndex
CREATE INDEX "production_route_stages_route_id_idx" ON "production_route_stages"("route_id");

-- CreateIndex
CREATE UNIQUE INDEX "production_route_stages_route_id_sequence_key" ON "production_route_stages"("route_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "production_operators_user_id_key" ON "production_operators"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "operator_skills_operator_id_stage_id_key" ON "operator_skills"("operator_id", "stage_id");

-- CreateIndex
CREATE INDEX "stage_assignments_unit_id_idx" ON "stage_assignments"("unit_id");

-- CreateIndex
CREATE UNIQUE INDEX "stage_assignments_unit_id_stage_id_key" ON "stage_assignments"("unit_id", "stage_id");

-- CreateIndex
CREATE INDEX "units_production_route_id_idx" ON "units"("production_route_id");

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_production_route_id_fkey" FOREIGN KEY ("production_route_id") REFERENCES "production_routes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_stages" ADD CONSTRAINT "routing_stages_default_work_center_id_fkey" FOREIGN KEY ("default_work_center_id") REFERENCES "work_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_routes" ADD CONSTRAINT "production_routes_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "service_catalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_route_stages" ADD CONSTRAINT "production_route_stages_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "production_routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_route_stages" ADD CONSTRAINT "production_route_stages_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "routing_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_route_stages" ADD CONSTRAINT "production_route_stages_work_center_id_fkey" FOREIGN KEY ("work_center_id") REFERENCES "work_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_operators" ADD CONSTRAINT "production_operators_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_operators" ADD CONSTRAINT "production_operators_primary_work_center_id_fkey" FOREIGN KEY ("primary_work_center_id") REFERENCES "work_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operator_skills" ADD CONSTRAINT "operator_skills_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "production_operators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operator_skills" ADD CONSTRAINT "operator_skills_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "routing_stages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stage_assignments" ADD CONSTRAINT "stage_assignments_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stage_assignments" ADD CONSTRAINT "stage_assignments_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "routing_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stage_assignments" ADD CONSTRAINT "stage_assignments_work_center_id_fkey" FOREIGN KEY ("work_center_id") REFERENCES "work_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stage_assignments" ADD CONSTRAINT "stage_assignments_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "production_operators"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stage_assignments" ADD CONSTRAINT "stage_assignments_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
