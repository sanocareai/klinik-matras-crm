-- Integrasi Fase 1 (D-006): Order.status jadi turunan dari status Unit
-- (weakest-link), bukan ditulis manual lagi. Kolom di bawah HANYA untuk
-- override manual (kasus di luar pola normal) + jejak audit siapa/kapan/
-- kenapa — lihat services/orderStatusSync.js. Additive-only, tidak ada
-- data lama yang perlu dimigrasikan (default status_locked=false berarti
-- SEMUA order yang sudah ada langsung ikut dihitung otomatis begitu
-- deploy, tidak ada order yang tiba-tiba "terkunci").

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "status_locked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "status_override_at" TIMESTAMP(3),
ADD COLUMN     "status_override_by" TEXT,
ADD COLUMN     "status_override_note" TEXT;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_status_override_by_fkey" FOREIGN KEY ("status_override_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
