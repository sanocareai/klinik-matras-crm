-- AlterEnum
-- Tambahan satuan nyata untuk import data stock opname (lihat
-- backend/scripts/data/warehouse-import/) — additive, tidak menghapus/
-- mengubah nilai lama.
ALTER TYPE "MaterialUnit" ADD VALUE 'PACK';
ALTER TYPE "MaterialUnit" ADD VALUE 'ROLL';
ALTER TYPE "MaterialUnit" ADD VALUE 'BUNDLE';
ALTER TYPE "MaterialUnit" ADD VALUE 'ROD';
ALTER TYPE "MaterialUnit" ADD VALUE 'PAIR';
ALTER TYPE "MaterialUnit" ADD VALUE 'CAN';
ALTER TYPE "MaterialUnit" ADD VALUE 'BOX';
ALTER TYPE "MaterialUnit" ADD VALUE 'LITER';
