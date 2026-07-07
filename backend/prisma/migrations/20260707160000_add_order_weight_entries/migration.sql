-- CreateTable OrderWeightEntry
CREATE TABLE "OrderWeightEntry" (
    "id"        TEXT NOT NULL,
    "orderId"   TEXT NOT NULL,
    "label"     TEXT NOT NULL,
    "beratKg"   INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "OrderWeightEntry_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "OrderWeightEntry" ADD CONSTRAINT "OrderWeightEntry_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Index
CREATE INDEX "OrderWeightEntry_orderId_idx" ON "OrderWeightEntry"("orderId");
