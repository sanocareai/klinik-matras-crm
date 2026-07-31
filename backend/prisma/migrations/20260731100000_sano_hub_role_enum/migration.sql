-- Sano Hub Phase 0 (1/2) — perluasan enum Role.
--
-- KENAPA MIGRASI INI TERPISAH DAN CUMA BERISI ALTER TYPE:
-- Postgres melarang MEMAKAI value enum yang baru ditambahkan di dalam
-- transaksi yang SAMA dengan penambahannya ("unsafe use of new value of enum
-- type"). Prisma membungkus tiap file migrasi dalam satu transaksi. Jadi
-- penambahan value harus berdiri sendiri, dan migrasi berikutnya
-- (20260731100100) baru boleh memakainya.
--
-- Jangan menggabungkan file ini dengan migrasi lain.

ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'PRODUCTION_LEAD';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'PRODUCTION_WORKER';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'QC_LEAD';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'WAREHOUSE';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'DISPATCHER';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'DRIVER';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'FINANCE';
