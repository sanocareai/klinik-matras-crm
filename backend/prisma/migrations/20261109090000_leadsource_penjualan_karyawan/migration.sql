-- Sumber customer "Penjualan Karyawan" (Okt 2026) — ADITIF murni: 1 nilai enum, tanpa backfill, tanpa UPDATE/DELETE.
-- Sengaja BERKAS TERSENDIRI: ALTER TYPE ... ADD VALUE tidak boleh dipakai pada transaksi yang sama dengan penggunaannya (tidak ada pemakaian di sini).

-- AlterEnum
ALTER TYPE "LeadSource" ADD VALUE IF NOT EXISTS 'PENJUALAN_KARYAWAN';
