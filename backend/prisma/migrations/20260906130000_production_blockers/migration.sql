-- Production Core Slice 2 (6 September 2026) — lifecycle blokir produksi.
-- Lihat catatan panjang di schema.prisma model ProductionBlocker untuk
-- kenapa tabel ini ADA DI SAMPING (bukan pengganti) unit_stage_logs.
--
-- ADITIF MURNI: satu tabel baru, tiga kolom index baru di "units" (sudah
-- ada sejak Slice 1, dipakai Command Center — @@index([productionDueAt]),
-- @@index([priority])), tidak ada kolom/data lama yang disentuh.
--
-- Rollback manual:
--   DROP TABLE "production_blockers";
--   ALTER TABLE "units" DROP INDEX ... (lihat nama index di bawah)

-- CreateTable
CREATE TABLE "production_blockers" (
    "id"              UUID NOT NULL,
    "unit_id"         UUID NOT NULL,
    "stage_id"        UUID,
    "stage_log_id"    UUID,
    "reason"          "BlockReason" NOT NULL,
    "note"            TEXT,
    "opened_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "opened_by"       TEXT,
    "resolved_at"     TIMESTAMP(3),
    "resolved_by"     TEXT,
    "resolution_note" TEXT,
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_blockers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "production_blockers_unit_id_idx" ON "production_blockers"("unit_id");
CREATE INDEX "production_blockers_resolved_at_idx" ON "production_blockers"("resolved_at");

-- Invarian "satu blokir AKTIF per unit" (D-003: satu unit cuma punya SATU
-- currentStageId aktif sekaligus, jadi tidak pernah ada dua tahap berjalan
-- bersamaan yang sah-sah saja blocked bersamaan). Partial unique index —
-- BOLEH ada banyak baris RESOLVED lama untuk unit yang sama (riwayat),
-- tapi cuma 1 yang resolved_at IS NULL (masih terbuka) di satu waktu.
-- Race dua "Tandai Terhambat" bersamaan akan membuat percobaan KEDUA gagal
-- dengan unique constraint violation (P2002 di Prisma), bukan diam-diam
-- membuat dua blokir aktif — lihat failStage() di unitStageEngine.js.
CREATE UNIQUE INDEX "production_blockers_unit_id_open_key"
  ON "production_blockers" ("unit_id")
  WHERE "resolved_at" IS NULL;

-- AddForeignKey — RESTRICT: unit yang punya riwayat blokir tidak boleh
-- terhapus diam-diam, sama alasannya dengan scope_revisions/unit_revisions.
ALTER TABLE "production_blockers" ADD CONSTRAINT "production_blockers_unit_id_fkey"
    FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Tahap boleh dinonaktifkan/diganti tanpa menghancurkan riwayat blokir.
ALTER TABLE "production_blockers" ADD CONSTRAINT "production_blockers_stage_id_fkey"
    FOREIGN KEY ("stage_id") REFERENCES "routing_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Baris ledger (unit_stage_logs) yang membuka blokir ini — jejak langsung
-- ke ledger produksi, SetNull karena baris log append-only tidak pernah
-- dihapus dalam praktik tapi skema tidak memaksakan itu.
ALTER TABLE "production_blockers" ADD CONSTRAINT "production_blockers_stage_log_id_fkey"
    FOREIGN KEY ("stage_log_id") REFERENCES "unit_stage_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- SetNull untuk aktor: pegawai resign, riwayat operasional TETAP ada — pola
-- yang sama dengan unit_stage_logs.actor & scope_revisions.decided_by.
ALTER TABLE "production_blockers" ADD CONSTRAINT "production_blockers_opened_by_fkey"
    FOREIGN KEY ("opened_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "production_blockers" ADD CONSTRAINT "production_blockers_resolved_by_fkey"
    FOREIGN KEY ("resolved_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Command Center (Slice 2) menyaring/mengurutkan SELURUH unit aktif
-- berdasarkan productionDueAt & priority tiap dibuka — tanpa index ini itu
-- full-scan "units" setiap request.
CREATE INDEX "units_production_due_at_idx" ON "units"("production_due_at");
CREATE INDEX "units_priority_idx" ON "units"("priority");
