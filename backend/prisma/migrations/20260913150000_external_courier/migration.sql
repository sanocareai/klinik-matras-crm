-- AlterTable
ALTER TABLE "User" ADD COLUMN     "is_external_courier" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "external_courier_ref" TEXT,
ADD COLUMN     "external_courier_cost" INTEGER;
