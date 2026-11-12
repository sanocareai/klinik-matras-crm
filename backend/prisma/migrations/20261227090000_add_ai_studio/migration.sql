-- AI Studio MVP 1 (Nov 2026) — ADDITIVE: 6 tabel studio_* + 4 enum Studio*.
-- Rollback: DROP TABLE "studio_feedback", "studio_messages", "studio_sessions", "studio_test_cases", "studio_skill_versions", "studio_agents"; DROP TYPE "StudioFeedbackStatus", "StudioRating", "StudioMessageRole", "StudioVersionStatus";

-- CreateEnum
CREATE TYPE "StudioVersionStatus" AS ENUM ('DRAFT', 'LIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "StudioMessageRole" AS ENUM ('CUSTOMER', 'AGENT');

-- CreateEnum
CREATE TYPE "StudioRating" AS ENUM ('GOOD', 'BAD');

-- CreateEnum
CREATE TYPE "StudioFeedbackStatus" AS ENUM ('NEW', 'ACCEPTED', 'REJECTED');

-- CreateTable
CREATE TABLE "studio_agents" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "defaultModel" TEXT NOT NULL DEFAULT 'claude-haiku-5-5',
    "config" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "studio_agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "studio_skill_versions" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" "StudioVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "changeNote" TEXT,
    "files" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "studio_skill_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "studio_sessions" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "skillVersionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "scenario" TEXT,
    "model" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "studio_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "studio_messages" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" "StudioMessageRole" NOT NULL,
    "content" JSONB NOT NULL,
    "model" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "studio_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "studio_feedback" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "rating" "StudioRating" NOT NULL,
    "idealReply" TEXT,
    "reasons" TEXT[],
    "note" TEXT,
    "status" "StudioFeedbackStatus" NOT NULL DEFAULT 'NEW',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "studio_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "studio_test_cases" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "history" JSONB NOT NULL,
    "idealReply" TEXT NOT NULL,
    "mustRules" TEXT[],
    "sourceFeedbackId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "studio_test_cases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "studio_agents_slug_key" ON "studio_agents"("slug");

-- CreateIndex
CREATE INDEX "studio_skill_versions_agentId_status_idx" ON "studio_skill_versions"("agentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "studio_skill_versions_agentId_versionNumber_key" ON "studio_skill_versions"("agentId", "versionNumber");

-- CreateIndex
CREATE INDEX "studio_sessions_createdById_createdAt_idx" ON "studio_sessions"("createdById", "createdAt");

-- CreateIndex
CREATE INDEX "studio_sessions_agentId_createdAt_idx" ON "studio_sessions"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "studio_messages_sessionId_createdAt_idx" ON "studio_messages"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "studio_messages_createdAt_idx" ON "studio_messages"("createdAt");

-- CreateIndex
CREATE INDEX "studio_feedback_status_createdAt_idx" ON "studio_feedback"("status", "createdAt");

-- CreateIndex
CREATE INDEX "studio_feedback_messageId_idx" ON "studio_feedback"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "studio_test_cases_sourceFeedbackId_key" ON "studio_test_cases"("sourceFeedbackId");

-- CreateIndex
CREATE INDEX "studio_test_cases_agentId_active_idx" ON "studio_test_cases"("agentId", "active");

-- AddForeignKey
ALTER TABLE "studio_skill_versions" ADD CONSTRAINT "studio_skill_versions_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "studio_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_sessions" ADD CONSTRAINT "studio_sessions_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "studio_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_messages" ADD CONSTRAINT "studio_messages_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "studio_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_feedback" ADD CONSTRAINT "studio_feedback_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "studio_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_test_cases" ADD CONSTRAINT "studio_test_cases_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "studio_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

