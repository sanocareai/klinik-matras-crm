-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "mediaType" TEXT,
ALTER COLUMN "content" SET DEFAULT '';
