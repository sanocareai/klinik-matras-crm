-- AlterTable
ALTER TABLE "ConversationQualityScore" ADD COLUMN     "evidenceBasedSellingScore" INTEGER,
ADD COLUMN     "evidenceBasedSellingQuote" TEXT,
ADD COLUMN     "evidenceBasedSellingQuote2" TEXT,
ADD COLUMN     "evidenceBasedSellingStrength" TEXT,
ADD COLUMN     "evidenceBasedSellingWeakness" TEXT,
ADD COLUMN     "authorityStructureFollowed" BOOLEAN,
ADD COLUMN     "evidenceUsed" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "evidenceExplained" BOOLEAN,
ADD COLUMN     "storySellingUsed" BOOLEAN;
