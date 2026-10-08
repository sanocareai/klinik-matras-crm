-- Gap Fase 3 item 3 (katalog bahan Catatan Komponen): kolom aditif pada materials, nullable, tanpa backfill.
ALTER TABLE "materials" ADD COLUMN "density" DOUBLE PRECISION;
ALTER TABLE "materials" ADD COLUMN "thickness_cm" DOUBLE PRECISION;
