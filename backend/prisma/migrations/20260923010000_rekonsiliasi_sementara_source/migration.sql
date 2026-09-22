-- Penyesuaian sementara rekonsiliasi bank — nilai enum baru, aditif murni.
-- Lihat services/finance/posting/rekonsiliasiSementara.js dan accounts.js
-- (akun 2-1700 "Dana Masuk Belum Teridentifikasi", dipasang idempoten lewat
-- ensureDefaultChartOfAccounts, BUKAN lewat migrasi ini).

-- AlterEnum
ALTER TYPE "FinJournalSource" ADD VALUE 'REKONSILIASI_SEMENTARA';

