-- CreateTable
CREATE TABLE "PlaygroundMessage" (
    "id" TEXT NOT NULL,
    "modelConfigId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "modelName" TEXT,
    "modelProvider" TEXT,
    "modelStr" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlaygroundMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlaygroundMessage_modelConfigId_idx" ON "PlaygroundMessage"("modelConfigId");
