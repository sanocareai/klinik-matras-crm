-- CreateEnum
CREATE TYPE "RescheduleCaseStatus" AS ENUM ('AKTIF', 'SELESAI', 'DIBATALKAN');

-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "reschedule_case_id" UUID;

-- CreateTable
CREATE TABLE "reschedule_cases" (
    "id" UUID NOT NULL,
    "case_number" TEXT NOT NULL,
    "job_id" UUID NOT NULL,
    "status" "RescheduleCaseStatus" NOT NULL DEFAULT 'AKTIF',
    "round" INTEGER NOT NULL DEFAULT 1,
    "cause" "RescheduleCause" NOT NULL,
    "reason" TEXT NOT NULL,
    "previous_scheduled_date" DATE,
    "new_scheduled_date" DATE,
    "customer_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "customer_notified_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "reschedule_cases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reschedule_cases_case_number_key" ON "reschedule_cases"("case_number");

-- CreateIndex
CREATE INDEX "reschedule_cases_job_id_created_at_idx" ON "reschedule_cases"("job_id", "created_at");

-- CreateIndex
CREATE INDEX "reschedule_cases_status_idx" ON "reschedule_cases"("status");

-- CreateIndex
CREATE INDEX "jobs_reschedule_case_id_idx" ON "jobs"("reschedule_case_id");

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_reschedule_case_id_fkey" FOREIGN KEY ("reschedule_case_id") REFERENCES "reschedule_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reschedule_cases" ADD CONSTRAINT "reschedule_cases_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reschedule_cases" ADD CONSTRAINT "reschedule_cases_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
