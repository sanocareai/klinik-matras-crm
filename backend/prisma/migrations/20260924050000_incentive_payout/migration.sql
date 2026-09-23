-- Pembayaran Insentif Driver — ledger append-only (24 September 2026).
-- Lihat komentar panjang di schema.prisma model IncentivePayout.
-- CreateEnum
CREATE TYPE "IncentivePayoutMethod" AS ENUM ('TRANSFER', 'CASH', 'OTHER');

-- CreateTable
CREATE TABLE "incentive_payouts" (
    "id" UUID NOT NULL,
    "snapshot_id" UUID NOT NULL,
    "snapshot_line_id" UUID NOT NULL,
    "user_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" "IncentivePayoutMethod" NOT NULL,
    "paid_at" TIMESTAMP(3) NOT NULL,
    "reference_number" TEXT,
    "proof_url" TEXT,
    "note" TEXT,
    "recorded_by" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "voided_at" TIMESTAMP(3),
    "voided_by" TEXT,
    "void_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incentive_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "incentive_payouts_idempotency_key_key" ON "incentive_payouts"("idempotency_key");

-- CreateIndex
CREATE INDEX "incentive_payouts_snapshot_id_idx" ON "incentive_payouts"("snapshot_id");

-- CreateIndex
CREATE INDEX "incentive_payouts_snapshot_line_id_idx" ON "incentive_payouts"("snapshot_line_id");

-- CreateIndex
CREATE INDEX "incentive_payouts_user_id_idx" ON "incentive_payouts"("user_id");

-- AddForeignKey
ALTER TABLE "incentive_payouts" ADD CONSTRAINT "incentive_payouts_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "incentive_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive_payouts" ADD CONSTRAINT "incentive_payouts_snapshot_line_id_fkey" FOREIGN KEY ("snapshot_line_id") REFERENCES "incentive_snapshot_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive_payouts" ADD CONSTRAINT "incentive_payouts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive_payouts" ADD CONSTRAINT "incentive_payouts_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive_payouts" ADD CONSTRAINT "incentive_payouts_voided_by_fkey" FOREIGN KEY ("voided_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
