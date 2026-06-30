-- STEP 2: Data migration + schema baru.
-- ALTER TYPE ADD VALUE dari migration sebelumnya sudah di-commit,
-- jadi nilai 'META_ADS' dan 'WEBSITE_ORGANIC' aman dipakai di sini.

-- Migrasikan data lama ke nilai baru
UPDATE "Customer" SET "leadSource" = 'META_ADS'        WHERE "leadSource" = 'ADS';
UPDATE "Customer" SET "leadSource" = 'WEBSITE_ORGANIC' WHERE "leadSource" = 'WEBSITE';

-- Buat enum LinkCategory (idempotent)
DO $$ BEGIN
  CREATE TYPE "LinkCategory" AS ENUM ('META_ADS', 'GOOGLE_ADS', 'WEBSITE_ORGANIC', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Tambah kolom baru ke Customer
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "leadSourceDetail"    TEXT;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "leadSourceConfirmed" BOOLEAN NOT NULL DEFAULT false;

-- Buat tabel TrackedLink
CREATE TABLE IF NOT EXISTS "TrackedLink" (
    "id"               TEXT NOT NULL,
    "slug"             TEXT NOT NULL,
    "name"             TEXT NOT NULL,
    "category"         "LinkCategory" NOT NULL,
    "prefilledMessage" TEXT NOT NULL DEFAULT 'Halo Sano, saya mau konsultasi',
    "targetPhone"      TEXT,
    "active"           BOOLEAN NOT NULL DEFAULT true,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackedLink_pkey" PRIMARY KEY ("id")
);

-- Buat tabel ClickEvent
CREATE TABLE IF NOT EXISTS "ClickEvent" (
    "id"                TEXT NOT NULL,
    "trackedLinkId"     TEXT NOT NULL,
    "matchedCustomerId" TEXT,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClickEvent_pkey" PRIMARY KEY ("id")
);

-- Index (idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS "TrackedLink_slug_key" ON "TrackedLink"("slug");
CREATE INDEX IF NOT EXISTS "ClickEvent_createdAt_idx" ON "ClickEvent"("createdAt");

-- Foreign key (idempotent)
DO $$ BEGIN
  ALTER TABLE "ClickEvent" ADD CONSTRAINT "ClickEvent_trackedLinkId_fkey"
      FOREIGN KEY ("trackedLinkId") REFERENCES "TrackedLink"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
