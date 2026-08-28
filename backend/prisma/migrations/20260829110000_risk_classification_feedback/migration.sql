-- Feedback manual admin thd kartu Pelanggan Berisiko yang dianggap salah
-- kategori — alat bantu audit, append-only (1 customer bisa ditandai >1x).
CREATE TABLE "RiskClassificationFeedback" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "severityAsli" TEXT NOT NULL,
    "alasanAsli" TEXT NOT NULL,
    "catatan" TEXT,
    "ditandaiOlehId" TEXT NOT NULL,
    "waktuDitandai" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskClassificationFeedback_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RiskClassificationFeedback_customerId_idx" ON "RiskClassificationFeedback"("customerId");

ALTER TABLE "RiskClassificationFeedback" ADD CONSTRAINT "RiskClassificationFeedback_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RiskClassificationFeedback" ADD CONSTRAINT "RiskClassificationFeedback_ditandaiOlehId_fkey"
    FOREIGN KEY ("ditandaiOlehId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
