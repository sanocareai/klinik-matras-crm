-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'HELPER';

-- AlterTable
ALTER TABLE "jobs" ADD COLUMN "helper_id" TEXT;

-- CreateIndex
CREATE INDEX "jobs_helper_id_idx" ON "jobs"("helper_id");

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_helper_id_fkey" FOREIGN KEY ("helper_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
