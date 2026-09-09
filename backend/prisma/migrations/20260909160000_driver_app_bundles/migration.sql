-- OTA self-hosted APK Driver (9 September 2026) -- lihat catatan panjang di
-- schema.prisma model DriverAppBundle & routes/driverApp.js.
--
-- ADITIF MURNI: 1 tabel baru, tidak menyentuh tabel lain.

CREATE TABLE "driver_app_bundles" (
    "id"           TEXT NOT NULL,
    "build_number" INTEGER NOT NULL,
    "channel"      TEXT NOT NULL DEFAULT 'production',
    "zip_filename" TEXT NOT NULL,
    "checksum"     TEXT NOT NULL,
    "active"       BOOLEAN NOT NULL DEFAULT true,
    "notes"        TEXT,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driver_app_bundles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "driver_app_bundles_build_number_key" ON "driver_app_bundles"("build_number");
CREATE INDEX "driver_app_bundles_channel_active_idx" ON "driver_app_bundles"("channel", "active");
