-- Order.paidAt (30 Agustus 2026) — kapan order jadi LUNAS, diisi otomatis
-- oleh recomputeOrderPaymentStatus() (services/paymentLedger.js) & PATCH
-- /orders/:id manual. Basis KOMISI SALES: SUM(value) WHERE paidAt di
-- rentang bulan, supaya angkanya TERKUNCI (tidak bergeser kalau laporan
-- dibuka belakangan) — lihat komentar panjang di schema.prisma Order model.
-- Nullable, TANPA backfill untuk order LUNAS lama (fabrikasi tanggal
-- historis yang tidak pernah tercatat — prinsip "tidak tahu lebih baik
-- daripada menebak"), jadi order lama akan NULL sampai status
-- pembayarannya berubah lagi.

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "paid_at" TIMESTAMP(3);
