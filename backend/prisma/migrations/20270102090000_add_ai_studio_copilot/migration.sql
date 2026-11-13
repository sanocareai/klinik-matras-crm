-- AI Studio MVP 2 Copilot (Nov 2026) — ADDITIVE: 1 tabel + 1 enum. Tidak mengubah tabel lain.
-- Rollback: DROP TABLE "studio_copilot_drafts"; DROP TYPE "StudioDraftOutcome";

-- CreateEnum
CREATE TYPE "StudioDraftOutcome" AS ENUM ('SHOWN', 'USED_AS_IS', 'USED_EDITED', 'IGNORED');

-- CreateTable
CREATE TABLE "studio_copilot_drafts" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "customerId" TEXT,
    "salesUserId" TEXT NOT NULL,
    "skillVersionId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "contextMessageId" TEXT,
    "output" JSONB NOT NULL,
    "outcome" "StudioDraftOutcome" NOT NULL DEFAULT 'SHOWN',
    "ignoreReason" TEXT,
    "sentText" TEXT,
    "crmSaved" JSONB,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "outcomeAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "studio_copilot_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "studio_copilot_drafts_salesUserId_createdAt_idx" ON "studio_copilot_drafts"("salesUserId", "createdAt");

-- CreateIndex
CREATE INDEX "studio_copilot_drafts_conversationId_createdAt_idx" ON "studio_copilot_drafts"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "studio_copilot_drafts_outcome_createdAt_idx" ON "studio_copilot_drafts"("outcome", "createdAt");

-- CreateIndex
CREATE INDEX "studio_copilot_drafts_createdAt_idx" ON "studio_copilot_drafts"("createdAt");
