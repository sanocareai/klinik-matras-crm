-- Gap Fase 3 item 3 (katalog bahan Catatan Komponen): kolom aditif pada materials, nullable, tanpa backfill.
ALTER TABLE "materials" ADD COLUMN IF NOT EXISTS "density" DOUBLE PRECISION;
ALTER TABLE "materials" ADD COLUMN IF NOT EXISTS "thickness_cm" DOUBLE PRECISION;
