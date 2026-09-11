-- Workspace B2B/Non-CRM (D-115, 11 September 2026) — lihat komentar
-- panjang di schema.prisma (enum Role.OWNER) dan LeadSource.B2B_DIRECT.
-- Murni ADITIF (ALTER TYPE ... ADD VALUE), tidak ada nilai lama yang
-- berubah/dihapus, tidak ada baris data yang tersentuh.
--
-- Rollback manual TIDAK tersedia untuk ALTER TYPE ADD VALUE (keterbatasan
-- Postgres) — kalau perlu, buat enum baru + migrasi kolom, bukan DROP VALUE.

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'OWNER';

-- AlterEnum
ALTER TYPE "LeadSource" ADD VALUE 'B2B_DIRECT';
