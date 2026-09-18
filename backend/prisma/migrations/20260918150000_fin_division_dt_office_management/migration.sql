-- Tambah 3 divisi biaya baru (permintaan owner, 18 Sep 2026): D&T (Digital
-- & Technology), Office (leader tiap divisi — meeting/survey/dll), dan
-- Management (owner — meeting/survey/dll). Murni aditif ke enum FinDivision,
-- tidak menyentuh baris yang sudah ada.

ALTER TYPE "FinDivision" ADD VALUE 'DIGITAL_TECHNOLOGY';
ALTER TYPE "FinDivision" ADD VALUE 'OFFICE';
ALTER TYPE "FinDivision" ADD VALUE 'MANAGEMENT';
