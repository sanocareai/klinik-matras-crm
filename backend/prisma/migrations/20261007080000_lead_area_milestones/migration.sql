-- Area layanan & milestone lead (konsultasi, penawaran) pada Customer.
-- ADITIF: satu enum baru + kolom nullable. Tidak ada DROP, UPDATE, DELETE,
-- atau perubahan tipe kolom lama. Baris lama tetap valid (semua kolom NULL).

CREATE TYPE "ServiceArea" AS ENUM ('JABODETABEK', 'BANDUNG', 'AREA_LAIN', 'LUAR_AREA');

ALTER TABLE "Customer"
  ADD COLUMN "service_area"        "ServiceArea",
  ADD COLUMN "service_area_set_at" TIMESTAMP(3),
  ADD COLUMN "service_area_set_by" TEXT,
  ADD COLUMN "consulted_at"        TIMESTAMP(3),
  ADD COLUMN "consulted_by"        TEXT,
  ADD COLUMN "quoted_at"           TIMESTAMP(3),
  ADD COLUMN "quoted_by"           TEXT,
  ADD COLUMN "quoted_source"       TEXT;
