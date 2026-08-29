-- Lini Produk (29 Agustus 2026) — perluasan bisnis dari kasur-saja ke
-- Sofa & Divan. Sumbu TERPISAH dari OrderCategory (kategori layanan tetap
-- LAYANAN/SEWA/BARU, tidak diubah) — lihat catatan panjang di schema.prisma.
CREATE TYPE "ProductLine" AS ENUM ('KASUR', 'SOFA', 'DIVAN');

CREATE TYPE "ProductType" AS ENUM (
  'KASUR_SPRING', 'KASUR_BUSA', 'MULTIBED', 'KASUR_2IN1_ATAS', 'KASUR_2IN1_BAWAH',
  'SOFABED', 'SOFA_L', 'SOFA_1_SEATER', 'SOFA_2_SEATER', 'SOFA_3_SEATER',
  'DIVAN_SANDARAN'
);

-- default KASUR: backfill otomatis semua order lama sbg Kasur (fakta
-- historis, bukan tebakan — 100% order sebelum ini memang kasur).
ALTER TABLE "Order" ADD COLUMN "product_line" "ProductLine" NOT NULL DEFAULT 'KASUR';

-- nullable TANPA default: order lama tidak pernah mencatat jenis produk
-- terstruktur, null = jujur tidak tahu.
ALTER TABLE "Order" ADD COLUMN "product_type" "ProductType";
