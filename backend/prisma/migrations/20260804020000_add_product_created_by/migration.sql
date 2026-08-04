-- Sales sekarang boleh menambah produk sendiri di Galeri Produk (sebelumnya
-- create/edit/delete produk admin-only). Kolom ini membedakan siapa yang
-- membuat produk supaya sales HANYA boleh edit/hapus produk buatannya
-- sendiri, bukan produk admin/sales lain — lihat requireOwnerOrAdmin di
-- routes/products.js. NULL = dibuat sebelum kolom ini ada (dianggap
-- "milik admin" oleh kode, aman karena admin selalu boleh edit apa pun).
--
-- Rollback manual:
--   ALTER TABLE "Product" DROP CONSTRAINT "Product_createdById_fkey", DROP COLUMN "createdById";

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "createdById" TEXT;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
