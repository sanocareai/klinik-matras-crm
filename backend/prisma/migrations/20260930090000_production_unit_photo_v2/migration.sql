-- P9B.1 — foto identitas unit (kartu Status Produksi/Rencana Produksi). Murni ADDITIF: satu enum baru + satu
-- tabel baru (unit_photos), tanpa ALTER/DROP pada tabel manapun yang sudah punya baris. Hanya menyimpan
-- unggahan manual Production (PRODUCTION_MANUAL) — foto pickup driver dibaca langsung dari Job.proofPhotoUrls
-- yang sudah ada, tidak disalin.

-- CreateEnum
CREATE TYPE "UnitPhotoSource" AS ENUM ('DRIVER_PICKUP', 'PRODUCTION_MANUAL');

-- CreateTable
CREATE TABLE "unit_photos" (
    "id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "source" "UnitPhotoSource" NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "uploaded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "superseded_at" TIMESTAMP(3),

    CONSTRAINT "unit_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "unit_photos_unit_id_source_superseded_at_idx" ON "unit_photos"("unit_id", "source", "superseded_at");

-- AddForeignKey
ALTER TABLE "unit_photos" ADD CONSTRAINT "unit_photos_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE CASCADE ON UPDATE CASCADE;
