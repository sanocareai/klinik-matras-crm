-- Pisahkan "Divan" dari "Sandaran" untuk kategori LAYANAN/Service-Upgrade
-- (4 Sep 2026) — lihat komentar di schema.prisma. Murni aditif.
ALTER TYPE "ProductType" ADD VALUE 'DIVAN_UTAMA' BEFORE 'DIVAN_SANDARAN';
