-- AlterTable
ALTER TABLE "Customer" ADD COLUMN "profilePictureFetchedAt" TIMESTAMP(3),
ADD COLUMN "nameManuallyEdited" BOOLEAN NOT NULL DEFAULT false;
