-- AlterTable
-- Menambah data referensi dari stock opname Excel asli (vendor, sub-kategori
-- "BARANG", harga & nilai stok referensi Agustus 2026) — semua nullable,
-- additive, tidak menyentuh baris yang sudah ada.
ALTER TABLE "materials" ADD COLUMN "vendor" TEXT;
ALTER TABLE "materials" ADD COLUMN "item_group" TEXT;
ALTER TABLE "materials" ADD COLUMN "reference_unit_cost" INTEGER;
ALTER TABLE "materials" ADD COLUMN "reference_unit_cost_month" TEXT;
ALTER TABLE "materials" ADD COLUMN "reference_stock_value" INTEGER;
ALTER TABLE "materials" ADD COLUMN "reference_stock_value_month" TEXT;
