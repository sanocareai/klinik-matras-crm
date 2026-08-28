-- AlterTable
ALTER TABLE "ConversationQualityScore" ADD COLUMN     "akuiPresent" BOOLEAN,
ADD COLUMN     "akuiPresentQuote" TEXT,
ADD COLUMN     "galiPresent" BOOLEAN,
ADD COLUMN     "galiPresentQuote" TEXT;
