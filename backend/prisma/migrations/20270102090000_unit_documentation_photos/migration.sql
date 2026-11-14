-- Dokumentasi tambahan unit (14 Nov 2026) — ADDITIVE: 1 tabel baru, tidak mengubah data apa pun.
-- Rollback: DROP TABLE "unit_documentation_photos";

-- CreateTable
CREATE TABLE "unit_documentation_photos" (
    "id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "uploaded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unit_documentation_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "unit_documentation_photos_unit_id_category_storage_key_key" ON "unit_documentation_photos"("unit_id", "category", "storage_key");

-- CreateIndex
CREATE INDEX "unit_documentation_photos_unit_id_created_at_idx" ON "unit_documentation_photos"("unit_id", "created_at");

-- AddForeignKey
ALTER TABLE "unit_documentation_photos" ADD CONSTRAINT "unit_documentation_photos_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE CASCADE ON UPDATE CASCADE;
