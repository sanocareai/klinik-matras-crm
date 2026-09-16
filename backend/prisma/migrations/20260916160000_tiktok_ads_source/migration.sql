-- TikTok Ads sebagai sumber lead (D-165, 16 September 2026) — lihat
-- komentar panjang di schema.prisma (enum LeadSource.TIKTOK_ADS dan
-- LinkCategory.TIKTOK_ADS). Murni ADITIF (ALTER TYPE ... ADD VALUE), tidak
-- ada nilai lama yang berubah/dihapus, tidak ada baris data yang tersentuh.
--
-- Rollback manual TIDAK tersedia untuk ALTER TYPE ADD VALUE (keterbatasan
-- Postgres) — kalau perlu, buat enum baru + migrasi kolom, bukan DROP VALUE.

-- AlterEnum
ALTER TYPE "LeadSource" ADD VALUE 'TIKTOK_ADS';

-- AlterEnum
ALTER TYPE "LinkCategory" ADD VALUE 'TIKTOK_ADS';
