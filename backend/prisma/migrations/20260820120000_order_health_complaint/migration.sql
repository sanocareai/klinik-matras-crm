-- CreateEnum
CREATE TYPE "HealthComplaintCategory" AS ENUM ('KEPALA_PUSING', 'SAKIT_PINGGANG', 'SAKIT_PUNGGUNG', 'SAKIT_LEHER', 'PEGAL_PEGAL', 'SARAF_KEJEPIT', 'SKOLIOSIS', 'LAINNYA');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "health_status" "HealthStatus",
ADD COLUMN "complaint_category" "HealthComplaintCategory";
