-- Sano Hub Phase 1 (1/2) — ledger tahap produksi + Job pickup/delivery.
--
-- ADITIF. Tidak mengubah semantik Order.status maupun UI mana pun yang sudah
-- jalan — belum ada endpoint yang menulis ke tabel-tabel ini.
--
-- Rollback manual:
--   DROP TABLE "job_units"; DROP TABLE "jobs";
--   DROP TABLE "unit_stage_logs";
--   DROP TYPE "JobType"; DROP TYPE "JobStatus";
--   DROP TYPE "StageLogAction"; DROP TYPE "BlockReason";

-- ---------------------------------------------------------------------------
-- 1. unit_stage_logs — ledger APPEND-ONLY (Aturan #2, CLAUDE.md)
-- ---------------------------------------------------------------------------
-- Generik untuk SEMUA tahap (PRD §5.1). Data spesifik Uji Berat Badan
-- (verdict PAS/TERLALU_KERAS/dst, override customer, edukasi yang diberikan —
-- lihat ROUTING.md §4) SENGAJA TIDAK di sini — itu tabel tersendiri yang
-- menyusul bersama transition engine, supaya ledger generik ini tetap bersih
-- dan tidak menjadi "satu struktur untuk segalanya" (anti-pattern CLAUDE.md).

CREATE TYPE "StageLogAction" AS ENUM ('START', 'PAUSE', 'COMPLETE', 'FAIL', 'SKIP');

-- Alasan blokir produksi. TERPISAH dari UnitStatus.READY_ON_CUSTOMER_HOLD
-- (Phase 0) — hold atas permintaan customer BUKAN blokir produksi (D-007),
-- jamnya tidak boleh tercampur dengan alasan-alasan di bawah ini.
CREATE TYPE "BlockReason" AS ENUM (
    'MATERIAL_SHORTAGE',
    'AWAITING_CUSTOMER_APPROVAL',
    'MACHINE_DOWN',
    'QUALITY_ISSUE',
    'OTHER'
);

CREATE TABLE "unit_stage_logs" (
    "id"               UUID             NOT NULL,
    "unit_id"          UUID             NOT NULL,
    "stage_id"         UUID             NOT NULL,
    "action"           "StageLogAction" NOT NULL,

    -- SetNull, bukan Cascade: pekerja resign, riwayat produksinya TETAP ada
    -- (data operasional tidak boleh hilang karena pegawai keluar).
    "actor_id"         TEXT,

    "started_at"       TIMESTAMP(3),
    "ended_at"         TIMESTAMP(3),
    "duration_seconds" INTEGER,

    -- Wajib diisi kalau action = 'FAIL' dan alasannya blokir produksi.
    "block_reason"     "BlockReason",
    "note"             TEXT,

    -- Kolom SIAP PAKAI untuk foto (requires_photo di routing_stages) — belum
    -- ada endpoint upload yang mengisinya di langkah ini, tapi kolomnya perlu
    -- ada sebelum transition engine ditulis supaya skema tidak berubah lagi
    -- begitu upload disambungkan.
    "photo_urls"       TEXT[]           NOT NULL DEFAULT '{}',

    "created_at"       TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unit_stage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Dua pola akses utama: "riwayat 1 unit" (timeline per unit) dan "berapa lama
-- rata-rata tahap X" (analisa cycle time per tahap).
CREATE INDEX "unit_stage_logs_unit_id_created_at_idx" ON "unit_stage_logs"("unit_id", "created_at");
CREATE INDEX "unit_stage_logs_stage_id_created_at_idx" ON "unit_stage_logs"("stage_id", "created_at");

-- AddForeignKey
-- Cascade dari Unit: konsisten dengan pola pipeline_transitions/
-- order_status_transitions di repo ini (log tidak bermakna tanpa induknya).
-- Unit sendiri sudah RESTRICT dari Order, jadi unit nyaris tidak pernah
-- benar-benar dihapus di jalur normal.
ALTER TABLE "unit_stage_logs" ADD CONSTRAINT "unit_stage_logs_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- RESTRICT: tahap yang sudah punya riwayat log tidak boleh dihapus diam-diam.
ALTER TABLE "unit_stage_logs" ADD CONSTRAINT "unit_stage_logs_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "routing_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_stage_logs" ADD CONSTRAINT "unit_stage_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 2. jobs — pickup & delivery, SENGAJA MINIMAL (PRD §11 Phase 1: penjadwalan
--    manual, TANPA dispatch board, TANPA route builder, TANPA vehicle capacity
--    — itu semua Phase 2. "Jangan membangun untuk nanti", CLAUDE.md §7.8.)
-- ---------------------------------------------------------------------------

CREATE TYPE "JobType" AS ENUM ('PICKUP', 'DELIVERY');

-- PRD §6.3, apa adanya.
CREATE TYPE "JobStatus" AS ENUM (
    'UNSCHEDULED', 'SCHEDULED', 'ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'COMPLETED',
    'FAILED', 'RESCHEDULED'
);

CREATE TABLE "jobs" (
    "id"             UUID         NOT NULL,
    "type"           "JobType"    NOT NULL,
    "order_id"       TEXT         NOT NULL,

    "scheduled_date" DATE,
    "time_window"    TEXT,

    -- Nullable sampai ditugaskan — PRD §6.3 UNSCHEDULED -> SCHEDULED -> ASSIGNED.
    "driver_id"      TEXT,
    "status"         "JobStatus"  NOT NULL DEFAULT 'UNSCHEDULED',

    -- Snapshot alamat PER KUNJUNGAN, bukan tabel Address bersama — CRM ini
    -- belum punya entitas Address sama sekali (Customer cuma punya "city").
    -- PRD §5.1: GPS yang benar didapat dari pin SUKSES PERTAMA di lapangan,
    -- jadi ini properti kunjungan dulu, baru layak didenormalisasi balik ke
    -- Customer setelah terbukti akurat — itu keputusan terpisah, bukan bagian
    -- langkah ini.
    "address_text"   TEXT,
    "lat"            DOUBLE PRECISION,
    "lng"            DOUBLE PRECISION,
    "access_notes"   TEXT,

    -- FR-D-07: setiap kegagalan WAJIB alasan + foto, tanpa kecuali.
    "failure_reason" TEXT,

    "arrived_at"     TIMESTAMP(3),
    "completed_at"   TIMESTAMP(3),

    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "jobs_order_id_idx" ON "jobs"("order_id");
CREATE INDEX "jobs_driver_id_scheduled_date_idx" ON "jobs"("driver_id", "scheduled_date"); -- "job saya hari ini" driver
CREATE INDEX "jobs_status_scheduled_date_idx" ON "jobs"("status", "scheduled_date"); -- papan Armada

-- AddForeignKey
-- RESTRICT: order dengan riwayat job tidak boleh dihapus diam-diam.
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 3. job_units — Job membawa SEBAGIAN unit sebuah order, bukan semuanya
--    (D-006: pengiriman hotel bertahap, tahap 1: 15 kasur, tahap 2: 15 kasur)
-- ---------------------------------------------------------------------------
CREATE TABLE "job_units" (
    "id"      UUID NOT NULL,
    "job_id"  UUID NOT NULL,
    "unit_id" UUID NOT NULL,

    CONSTRAINT "job_units_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Satu unit TIDAK BOLEH dobel-dijadwalkan di dua job AKTIF dengan tipe yang
-- sama (mis. dua job PICKUP untuk unit yang sama) — tapi database tidak bisa
-- tahu "aktif" tanpa melihat status job, jadi itu diperiksa di aplikasi.
-- Constraint di sini cuma mencegah baris DUPLIKAT literal (unit yang sama
-- dua kali di job yang sama).
CREATE UNIQUE INDEX "job_units_job_id_unit_id_key" ON "job_units"("job_id", "unit_id");
CREATE INDEX "job_units_unit_id_idx" ON "job_units"("unit_id");

-- AddForeignKey
ALTER TABLE "job_units" ADD CONSTRAINT "job_units_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- RESTRICT: unit yang sudah dijadwalkan di sebuah job tidak boleh dihapus
-- diam-diam (lagipula Unit nyaris tidak pernah dihapus, RESTRICT dari Order).
ALTER TABLE "job_units" ADD CONSTRAINT "job_units_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
