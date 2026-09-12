-- Status Online/Offline driver (12 September 2026, referensi Gojek/Grab
-- driver app) — murni ADITIF, nilai default aman (semua user dianggap
-- Offline sampai mereka toggle sendiri di app), tidak ada data lama yang
-- berubah/dihapus.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "is_online" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "online_since" TIMESTAMP(3);
