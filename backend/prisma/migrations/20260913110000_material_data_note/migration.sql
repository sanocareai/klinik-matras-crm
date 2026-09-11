-- Catatan gudang bebas teks di Material, dipakai untuk menandai data yang
-- BELUM LENGKAP di sumbernya (mis. order pemakaian bahan Sept 2026 yang
-- qty/tanggalnya belum diisi pemilik di Excel, atau material yang varian
-- warnanya masih ambigu) supaya kelihatan di UI Stock & Material.
ALTER TABLE "materials" ADD COLUMN "data_note" TEXT;
