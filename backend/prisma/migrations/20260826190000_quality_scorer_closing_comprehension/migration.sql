-- AlterTable
ALTER TABLE "ConversationQualityScore" ADD COLUMN     "closingAssertivenessScore" INTEGER,
ADD COLUMN     "closingAssertivenessQuote" TEXT,
ADD COLUMN     "closingAssertivenessNote" TEXT,
ADD COLUMN     "closingAskPresent" BOOLEAN,
ADD COLUMN     "customerComprehensionScore" INTEGER,
ADD COLUMN     "customerComprehensionQuote" TEXT,
ADD COLUMN     "customerComprehensionNote" TEXT,
ADD COLUMN     "plainLanguageUsed" BOOLEAN;

-- CreateTable
CREATE TABLE "SalesQualityWeeklyNarrative" (
    "id" TEXT NOT NULL,
    "salesUserId" TEXT NOT NULL,
    "salesName" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "weekEnd" TIMESTAMP(3) NOT NULL,
    "sampleCount" INTEGER NOT NULL DEFAULT 0,
    "narrative" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SalesQualityWeeklyNarrative_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SalesQualityWeeklyNarrative_salesUserId_weekStart_weekEnd_key" ON "SalesQualityWeeklyNarrative"("salesUserId", "weekStart", "weekEnd");

-- CreateIndex
CREATE INDEX "SalesQualityWeeklyNarrative_weekStart_idx" ON "SalesQualityWeeklyNarrative"("weekStart");
