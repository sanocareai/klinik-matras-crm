-- DropIndex
DROP INDEX IF EXISTS "OrderWeightEntry_orderId_idx";

-- CreateTable
CREATE TABLE "LidMapping" (
    "id" TEXT NOT NULL,
    "lid" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "session" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LidMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LidMapping_lid_key" ON "LidMapping"("lid");
