-- Wave 4B.0 — AI Sales Assistant audit log (ADDITIVE ONLY).
-- Reversible rollback (jalankan manual bila perlu revert):
--   DROP TABLE "ReplySuggestionLog";
--   DROP TYPE "ReplySuggestionFeedback";
--   DROP TYPE "ReplySuggestionStatus";
-- Tidak ada perubahan/relasi ke tabel lain.

-- CreateEnum
CREATE TYPE "ReplySuggestionStatus" AS ENUM ('GENERATED', 'COPIED', 'EDITED', 'SENT', 'DISMISSED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "ReplySuggestionFeedback" AS ENUM ('POSITIVE', 'NEGATIVE');

-- CreateTable
CREATE TABLE "ReplySuggestionLog" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT,
    "customerId" TEXT,
    "userId" TEXT NOT NULL,
    "intent" TEXT,
    "status" "ReplySuggestionStatus" NOT NULL DEFAULT 'GENERATED',
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "blockedReason" TEXT,
    "source" TEXT,
    "model" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "suggestionCount" INTEGER NOT NULL DEFAULT 0,
    "feedback" "ReplySuggestionFeedback",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReplySuggestionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReplySuggestionLog_userId_createdAt_idx" ON "ReplySuggestionLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ReplySuggestionLog_createdAt_idx" ON "ReplySuggestionLog"("createdAt");
