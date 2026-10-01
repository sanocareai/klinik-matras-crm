-- Penjualan Karyawan (1 Okt 2026) — ADITIF: satu kolom nullable + indeks + FK ke User (SET NULL). Tidak menyentuh data/ledger yang ada.
ALTER TABLE "Order" ADD COLUMN "staff_seller_id" TEXT;

CREATE INDEX "Order_staff_seller_id_idx" ON "Order"("staff_seller_id");

ALTER TABLE "Order" ADD CONSTRAINT "Order_staff_seller_id_fkey" FOREIGN KEY ("staff_seller_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
