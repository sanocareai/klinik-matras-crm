-- Riwayat lengkap siklus gagal/reschedule per job (9 September 2026, D-110)
-- — lihat komentar panjang di schema.prisma model JobIssueLog. Murni
-- aditif, tidak ada data yang berubah/dihapus.

-- CreateEnum
CREATE TYPE "JobIssueEventType" AS ENUM ('FAILED', 'RESCHEDULED');

-- CreateEnum
CREATE TYPE "RescheduleCause" AS ENUM ('PROACTIVE', 'AFTER_FAILURE');

-- CreateTable
CREATE TABLE "job_issue_logs" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "type" "JobIssueEventType" NOT NULL,
    "failure_reason" TEXT,
    "failure_photo_urls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "previous_scheduled_date" DATE,
    "new_scheduled_date" DATE,
    "reschedule_reason" TEXT,
    "customer_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "cause" "RescheduleCause",
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_issue_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "job_issue_logs_job_id_created_at_idx" ON "job_issue_logs"("job_id", "created_at");

-- AddForeignKey
ALTER TABLE "job_issue_logs" ADD CONSTRAINT "job_issue_logs_job_id_fkey"
  FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_issue_logs" ADD CONSTRAINT "job_issue_logs_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
