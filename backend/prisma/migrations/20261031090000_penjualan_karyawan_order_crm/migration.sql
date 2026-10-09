-- Sinkronisasi Penjualan Karyawan (PKR Finance) -> Order CRM -> Unit Produksi -> Delivery — ADITIF: 2 kolom nullable pada "Order", 1 indeks unik, 1 FK, dan 1 fungsi + 4 trigger PENGAMAN.
-- Tanpa UPDATE/DELETE/backfill: order, pembayaran, jurnal, dan PKR yang sudah ada TIDAK berubah. Kode lama mengabaikan kolom baru; trigger hanya menolak INSERT yang menunjuk order
-- ber-penjualan_karyawan_id (kolom itu NULL untuk SEMUA order yang ada sekarang), jadi tidak ada jalur lama yang terpengaruh.

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "penjualan_karyawan_id" UUID,
ADD COLUMN "pkr_perlu_dikirim" BOOLEAN;

-- CreateIndex
CREATE UNIQUE INDEX "Order_penjualan_karyawan_id_key" ON "Order"("penjualan_karyawan_id");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_penjualan_karyawan_id_fkey" FOREIGN KEY ("penjualan_karyawan_id") REFERENCES "fin_penjualan_karyawan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Pengaman terakhir: Order Penjualan Karyawan HANYA dokumen operasional. Nominal, pembayaran, piutang, invoice, dan jurnal dikelola PKR di Finance; uang/jurnal/invoice kedua
-- untuk order ini ditolak oleh database walau kode aplikasi (yang sudah menjaga lebih dulu) suatu hari salah.
CREATE FUNCTION fn_tolak_keuangan_order_pkr() RETURNS trigger AS $fn$
DECLARE
  oid text;
BEGIN
  IF TG_TABLE_NAME = 'OrderItem' THEN
    oid := NEW."orderId";
  ELSE
    oid := NEW.order_id;
  END IF;
  IF oid IS NOT NULL AND EXISTS (SELECT 1 FROM "Order" o WHERE o."id" = oid AND o."penjualan_karyawan_id" IS NOT NULL) THEN
    RAISE EXCEPTION 'Order Penjualan Karyawan hanya dokumen operasional: % tidak boleh dibuat untuk order ini (nominal dan pembayaran dikelola di Penjualan Karyawan, Finance)', TG_TABLE_NAME USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

CREATE TRIGGER trg_payments_tolak_order_pkr BEFORE INSERT ON "payments" FOR EACH ROW EXECUTE FUNCTION fn_tolak_keuangan_order_pkr();
CREATE TRIGGER trg_invoices_tolak_order_pkr BEFORE INSERT ON "invoices" FOR EACH ROW EXECUTE FUNCTION fn_tolak_keuangan_order_pkr();
CREATE TRIGGER trg_fin_journal_lines_tolak_order_pkr BEFORE INSERT ON "fin_journal_lines" FOR EACH ROW EXECUTE FUNCTION fn_tolak_keuangan_order_pkr();
CREATE TRIGGER trg_order_items_tolak_order_pkr BEFORE INSERT ON "OrderItem" FOR EACH ROW EXECUTE FUNCTION fn_tolak_keuangan_order_pkr();
