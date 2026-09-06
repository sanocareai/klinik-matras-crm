-- Route.manualMapsUrl (6 September 2026) — murni ADITIF, nullable, tidak
-- ada data lama yang perlu dibackfill (NULL = pakai auto-generate seperti
-- sebelumnya, perilaku default TIDAK berubah untuk rute yang sudah ada).
--
-- Rollback manual:
--   ALTER TABLE "routes" DROP COLUMN "manual_maps_url";

-- AlterTable
ALTER TABLE "routes" ADD COLUMN "manual_maps_url" TEXT;
