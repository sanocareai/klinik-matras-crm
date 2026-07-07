-- CreateTable: pesan masuk yang nomornya tidak bisa di-resolve (LID tak dikenal, JID tidak valid)
CREATE TABLE "UnresolvedMessage" (
    "id" TEXT NOT NULL,
    "rawJid" TEXT NOT NULL,
    "session" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "UnresolvedMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UnresolvedMessage_createdAt_idx" ON "UnresolvedMessage"("createdAt");

-- CreateTable: hasil nightly reconciliation — mencatat drift jumlah pesan WAHA vs DB
CREATE TABLE "SyncDiscrepancy" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "conversationId" TEXT,
    "wahaCount" INTEGER NOT NULL,
    "dbCount" INTEGER NOT NULL,
    "difference" INTEGER NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncDiscrepancy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SyncDiscrepancy_checkedAt_idx" ON "SyncDiscrepancy"("checkedAt");
