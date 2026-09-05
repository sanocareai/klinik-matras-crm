-- Status order "Pengiriman" (5 September 2026) — permintaan owner: order
-- sebelumnya loncat langsung READY->DELIVERED, tidak ada penanda "sedang
-- di jalan diantar" (beda dari PICKUP yang menandai "sedang di jalan
-- menjemput"). Murni aditif, tidak ada data yang berubah/dihapus.
ALTER TYPE "OrderStatus" ADD VALUE 'SHIPPING' BEFORE 'DELIVERED';
