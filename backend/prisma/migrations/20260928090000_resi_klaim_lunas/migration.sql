-- Resi Gabungan Fase 3A (hardening) — MURNI ADITIF: dua kolom nullable + satu index + satu FK pada "order_groups".
-- Klaim "Lunas" Sales di level Resi disimpan di grup, BUKAN di paymentStatus/paidAt child (itu hanya berubah lewat ledger setelah verifikasi Finance).
-- Tidak ada UPDATE/DELETE data lama; baris lama = NULL (tidak ada klaim yang menunggu).
ALTER TABLE "order_groups" ADD COLUMN "lunas_diklaim_pada" TIMESTAMP(3);
ALTER TABLE "order_groups" ADD COLUMN "lunas_diklaim_oleh" TEXT;

CREATE INDEX "order_groups_lunas_diklaim_pada_idx" ON "order_groups"("lunas_diklaim_pada");

ALTER TABLE "order_groups" ADD CONSTRAINT "order_groups_lunas_diklaim_oleh_fkey" FOREIGN KEY ("lunas_diklaim_oleh") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
