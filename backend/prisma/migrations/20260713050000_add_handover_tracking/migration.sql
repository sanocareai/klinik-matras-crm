-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "firstResponderId" TEXT;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "sentById" TEXT;

-- CreateTable
CREATE TABLE "HandoverEvent" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "fromUserId" TEXT,
    "toUserId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HandoverEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HandoverEvent_conversationId_createdAt_idx" ON "HandoverEvent"("conversationId", "createdAt");

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_firstResponderId_fkey" FOREIGN KEY ("firstResponderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandoverEvent" ADD CONSTRAINT "HandoverEvent_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandoverEvent" ADD CONSTRAINT "HandoverEvent_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandoverEvent" ADD CONSTRAINT "HandoverEvent_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
