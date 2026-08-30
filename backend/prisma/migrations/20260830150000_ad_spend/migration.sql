-- Biaya iklan bulanan per sumber lead — input manual admin, dipakai
-- menghitung CPA/ROAS per platform di Laporan > Traffic. Pola identik
-- SalesTarget (lihat migration 20260702162400).

-- CreateTable
CREATE TABLE "AdSpend" (
    "id" TEXT NOT NULL,
    "source" "LeadSource" NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdSpend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdSpend_source_year_month_key" ON "AdSpend"("source", "year", "month");

-- AddForeignKey
ALTER TABLE "AdSpend" ADD CONSTRAINT "AdSpend_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
