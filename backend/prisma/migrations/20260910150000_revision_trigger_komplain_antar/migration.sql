-- Kasus Richard (RES-30082026-201, 10 September 2026) — customer QC di
-- tempat saat serah terima & minta revisi HARI ITU JUGA, beda dari
-- KENYAMANAN (trial berhari-hari) atau GARANSI (klaim bertahun-tahun).
-- Murni ADITIF (ALTER TYPE ... ADD VALUE), tidak ada nilai lama yang
-- berubah/dihapus, tidak ada baris data yang tersentuh.
--
-- Rollback manual TIDAK tersedia untuk ALTER TYPE ADD VALUE (keterbatasan
-- Postgres) — kalau perlu, buat enum baru + migrasi kolom, bukan DROP VALUE.

-- AlterEnum
ALTER TYPE "RevisionTrigger" ADD VALUE 'KOMPLAIN_ANTAR';
