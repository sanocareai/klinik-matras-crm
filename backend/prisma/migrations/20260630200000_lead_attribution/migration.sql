-- STEP 1: Tambah nilai baru ke enum LeadSource.
-- Harus dipisah dari UPDATE yang menggunakan nilai baru karena PostgreSQL
-- mengharuskan ALTER TYPE ADD VALUE di-commit sebelum nilai baru bisa dipakai.
ALTER TYPE "LeadSource" ADD VALUE IF NOT EXISTS 'META_ADS';
ALTER TYPE "LeadSource" ADD VALUE IF NOT EXISTS 'GOOGLE_ADS';
ALTER TYPE "LeadSource" ADD VALUE IF NOT EXISTS 'WEBSITE_ORGANIC';
