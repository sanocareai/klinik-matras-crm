-- CreateTable
CREATE TABLE "ConversationQualityScore" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "customerId" TEXT,
    "salesUserId" TEXT NOT NULL,
    "salesName" TEXT NOT NULL,
    "pipelineStageAtSample" TEXT NOT NULL,
    "sampledFor" TIMESTAMP(3) NOT NULL,
    "productKnowledgeScore" INTEGER,
    "productKnowledgeQuote" TEXT,
    "productKnowledgeNote" TEXT,
    "consultationProcessScore" INTEGER,
    "consultationProcessQuote" TEXT,
    "consultationProcessNote" TEXT,
    "healthImpactScore" INTEGER,
    "healthImpactQuote" TEXT,
    "healthImpactNote" TEXT,
    "objectionHandlingScore" INTEGER,
    "objectionHandlingQuote" TEXT,
    "objectionHandlingNote" TEXT,
    "overallNote" TEXT,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationQualityScore_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConversationQualityScore_conversationId_sampledFor_key" ON "ConversationQualityScore"("conversationId", "sampledFor");

-- CreateIndex
CREATE INDEX "ConversationQualityScore_salesUserId_createdAt_idx" ON "ConversationQualityScore"("salesUserId", "createdAt");

-- CreateIndex
CREATE INDEX "ConversationQualityScore_sampledFor_idx" ON "ConversationQualityScore"("sampledFor");
