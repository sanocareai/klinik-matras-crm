-- CreateTable
CREATE TABLE "GoldStandardExample" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "salesName" TEXT NOT NULL,
    "relatedScore" INTEGER NOT NULL,
    "sampledFor" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoldStandardExample_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GoldStandardExample_category_idx" ON "GoldStandardExample"("category");
