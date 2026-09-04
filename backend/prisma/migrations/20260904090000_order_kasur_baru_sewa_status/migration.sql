-- Jenis Kasur baru (kategori BARU) + status khusus SEWA (4 Sep 2026) —
-- lihat komentar di schema.prisma. Murni aditif, tidak ada data yang berubah.
ALTER TYPE "ProductType" ADD VALUE 'KASUR_SEHAT';
ALTER TYPE "ProductType" ADD VALUE 'KASUR_2IN1';
ALTER TYPE "ProductType" ADD VALUE 'KASUR_LAINNYA';
ALTER TYPE "OrderStatus" ADD VALUE 'SEWA_DIKIRIM';
ALTER TYPE "OrderStatus" ADD VALUE 'SEWA_DIAMBIL';
