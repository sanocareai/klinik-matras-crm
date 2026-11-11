-- Main Hub — grant eksplisit HUB_ACCESS untuk leader (Okt 2026). ADITIF murni:
-- 1 nilai enum, tanpa backfill, tanpa UPDATE/DELETE. Berkas tersendiri karena
-- ALTER TYPE ... ADD VALUE tidak boleh dipakai pada transaksi yang sama dengan
-- pemakaiannya (tidak ada pemakaian di berkas ini).

-- AlterEnum
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'HUB_MEMBER';
