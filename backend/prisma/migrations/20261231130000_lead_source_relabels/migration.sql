-- Aditif: tabel jejak relabel sumber lead, tanpa mengubah tabel lain.
CREATE TABLE "lead_source_relabels" (
    "id" TEXT NOT NULL,
    "batch" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "sumberLama" "LeadSource",
    "detailLama" TEXT,
    "sumberBaru" "LeadSource" NOT NULL,
    "detailBaru" TEXT,
    "aturan" TEXT NOT NULL,
    "klikDilepasIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_source_relabels_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "lead_source_relabels_batch_customerId_key" ON "lead_source_relabels"("batch", "customerId");
CREATE INDEX "lead_source_relabels_customerId_idx" ON "lead_source_relabels"("customerId");
