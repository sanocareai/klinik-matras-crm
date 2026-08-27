-- AlterTable
ALTER TABLE "ConversationQualityScore" ADD COLUMN     "objectionType" TEXT,
ADD COLUMN     "objectionTypeQuote" TEXT,
ADD COLUMN     "frameworkFollowed" BOOLEAN,
ADD COLUMN     "frameworkFollowedQuote" TEXT;
