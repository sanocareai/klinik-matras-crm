-- Bukti Kelengkapan Standar (7 Okt 2026): kolom aditif pada routes, tanpa tabel baru, tanpa backfill.
ALTER TABLE "routes"
  ADD COLUMN "completeness_photo_urls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "completeness_note" TEXT,
  ADD COLUMN "completeness_submitted_at" TIMESTAMP(3),
  ADD COLUMN "completeness_submitted_by" TEXT;

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_completeness_submitted_by_fkey" FOREIGN KEY ("completeness_submitted_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
