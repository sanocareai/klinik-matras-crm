-- AlterTable
ALTER TABLE "ConversationQualityScore" ADD COLUMN     "communicationSkillScore" INTEGER,
ADD COLUMN     "communicationSkillQuote" TEXT,
ADD COLUMN     "communicationSkillStrength" TEXT,
ADD COLUMN     "communicationSkillWeakness" TEXT,
ADD COLUMN     "authoritySellingScore" INTEGER,
ADD COLUMN     "authoritySellingQuote" TEXT,
ADD COLUMN     "authoritySellingStrength" TEXT,
ADD COLUMN     "authoritySellingWeakness" TEXT,
ADD COLUMN     "objectionHandlingStrength" TEXT,
ADD COLUMN     "objectionHandlingWeakness" TEXT,
ADD COLUMN     "recommendedModule" TEXT;
