-- AlterTable
ALTER TABLE "delivery_execution_events" ADD COLUMN     "occurred_at" TIMESTAMP(3),
ADD COLUMN     "source" TEXT;
