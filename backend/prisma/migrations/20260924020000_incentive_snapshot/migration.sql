-- Snapshot Insentif Driver — pembekuan untuk pembayaran (24 September 2026).
-- Lihat komentar panjang di schema.prisma model IncentiveSnapshot.
-- CreateEnum
CREATE TYPE "IncentiveSnapshotStatus" AS ENUM ('DRAFT', 'REVIEWED', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "incentive_snapshots" (
    "id" UUID NOT NULL,
    "period_from" TEXT NOT NULL,
    "period_to" TEXT NOT NULL,
    "status" "IncentiveSnapshotStatus" NOT NULL DEFAULT 'DRAFT',
    "formula_version" TEXT NOT NULL,
    "total_alamat" INTEGER NOT NULL,
    "total_rupiah" INTEGER NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "computed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "reviewed_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "approved_by" TEXT,
    "rejected_at" TIMESTAMP(3),
    "rejected_by" TEXT,
    "rejection_reason" TEXT,
    "adjusts_snapshot_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "incentive_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incentive_snapshot_lines" (
    "id" UUID NOT NULL,
    "snapshot_id" UUID NOT NULL,
    "user_id" TEXT NOT NULL,
    "user_name" TEXT NOT NULL,
    "has_sim" BOOLEAN NOT NULL,
    "rate_per_alamat" INTEGER NOT NULL,
    "total_alamat" INTEGER NOT NULL,
    "total_rupiah" INTEGER NOT NULL,
    "as_driver" INTEGER NOT NULL,
    "as_helper" INTEGER NOT NULL,

    CONSTRAINT "incentive_snapshot_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incentive_snapshot_details" (
    "id" UUID NOT NULL,
    "snapshot_id" UUID NOT NULL,
    "line_id" UUID NOT NULL,
    "user_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "tanggal_wib" TEXT NOT NULL,
    "as_driver" BOOLEAN NOT NULL,
    "as_helper" BOOLEAN NOT NULL,
    "job_ids" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incentive_snapshot_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incentive_source_claims" (
    "id" UUID NOT NULL,
    "user_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "tanggal_wib" TEXT NOT NULL,
    "snapshot_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incentive_source_claims_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "incentive_snapshots_status_idx" ON "incentive_snapshots"("status");

-- CreateIndex
CREATE INDEX "incentive_snapshots_period_from_period_to_idx" ON "incentive_snapshots"("period_from", "period_to");

-- CreateIndex
CREATE INDEX "incentive_snapshot_lines_snapshot_id_idx" ON "incentive_snapshot_lines"("snapshot_id");

-- CreateIndex
CREATE INDEX "incentive_snapshot_lines_user_id_idx" ON "incentive_snapshot_lines"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "incentive_snapshot_lines_snapshot_id_user_id_key" ON "incentive_snapshot_lines"("snapshot_id", "user_id");

-- CreateIndex
CREATE INDEX "incentive_snapshot_details_snapshot_id_idx" ON "incentive_snapshot_details"("snapshot_id");

-- CreateIndex
CREATE INDEX "incentive_snapshot_details_user_id_order_id_tanggal_wib_idx" ON "incentive_snapshot_details"("user_id", "order_id", "tanggal_wib");

-- CreateIndex
CREATE UNIQUE INDEX "incentive_snapshot_details_snapshot_id_user_id_order_id_tan_key" ON "incentive_snapshot_details"("snapshot_id", "user_id", "order_id", "tanggal_wib");

-- CreateIndex
CREATE INDEX "incentive_source_claims_snapshot_id_idx" ON "incentive_source_claims"("snapshot_id");

-- CreateIndex
CREATE UNIQUE INDEX "incentive_source_claims_user_id_order_id_tanggal_wib_key" ON "incentive_source_claims"("user_id", "order_id", "tanggal_wib");

-- AddForeignKey
ALTER TABLE "incentive_snapshots" ADD CONSTRAINT "incentive_snapshots_computed_by_fkey" FOREIGN KEY ("computed_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive_snapshots" ADD CONSTRAINT "incentive_snapshots_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive_snapshots" ADD CONSTRAINT "incentive_snapshots_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive_snapshots" ADD CONSTRAINT "incentive_snapshots_rejected_by_fkey" FOREIGN KEY ("rejected_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive_snapshots" ADD CONSTRAINT "incentive_snapshots_adjusts_snapshot_id_fkey" FOREIGN KEY ("adjusts_snapshot_id") REFERENCES "incentive_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive_snapshot_lines" ADD CONSTRAINT "incentive_snapshot_lines_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "incentive_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive_snapshot_lines" ADD CONSTRAINT "incentive_snapshot_lines_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive_snapshot_details" ADD CONSTRAINT "incentive_snapshot_details_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "incentive_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive_snapshot_details" ADD CONSTRAINT "incentive_snapshot_details_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "incentive_snapshot_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive_source_claims" ADD CONSTRAINT "incentive_source_claims_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "incentive_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
