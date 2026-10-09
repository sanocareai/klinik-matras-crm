-- Sinkronisasi Penjualan Karyawan (PKR Finance) -> Order CRM -> Unit Produksi -> Delivery — ADITIF: 2 kolom nullable pada "Order", 1 indeks unik, 1 FK, dan 1 fungsi + 5 trigger PENGAMAN.
-- Tanpa UPDATE/DELETE/backfill: order, pembayaran, jurnal, dan PKR yang sudah ada TIDAK berubah. Kode lama mengabaikan kolom baru; trigger hanya menolak INSERT/UPDATE order_id yang menunjuk order
-- ber-penjualan_karyawan_id (kolom itu NULL untuk SEMUA order yang ada sekarang), jadi tidak ada jalur lama yang terpengaruh.

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "penjualan_karyawan_id" UUID,
ADD COLUMN "pkr_perlu_dikirim" BOOLEAN;

-- CreateIndex
CREATE UNIQUE INDEX "Order_penjualan_karyawan_id_key" ON "Order"("penjualan_karyawan_id");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_penjualan_karyawan_id_fkey" FOREIGN KEY ("penjualan_karyawan_id") REFERENCES "fin_penjualan_karyawan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Pengaman terakhir: Order Penjualan Karyawan HANYA dokumen operasional. Pendapatan, piutang, dan pembayaran customer dikelola PKR di Finance; uang/invoice/jurnal-pendapatan kedua
-- untuk order ini ditolak oleh database walau kode aplikasi (yang sudah menjaga lebih dulu) suatu hari salah.
--
-- RUANG LINGKUP SENGAJA SEMPIT (audit 9 Okt 2026) — yang ditolak HANYA posting finansial "customer membayar / pendapatan diakui / uang dikembalikan" untuk order PKR:
--   payments, invoices, fin_payment_allocations, OrderItem (nilai order), dan baris jurnal ber-order_id HANYA bila header jurnalnya PEMBAYARAN_ORDER / PENGAKUAN_PENDAPATAN / REFUND.
-- TIDAK diblokir: (a) jurnal resmi Penjualan Karyawan sendiri (sumber PENJUALAN_KARYAWAN / PEMBAYARAN_PENJUALAN_KARYAWAN, juga REVERSAL-nya) — tidak ber-order_id, dan andai suatu hari
-- diberi order_id order PKR-nya sendiri tetap lolos; (b) BIAYA operasional yang menandai order PKR sebagai dimensi analitik (bensin/tol/insentif driver/pemakaian bahan),
-- karena order itu memang dikirim dan diproduksi dan biayanya nyata. Order biasa (penjualan_karyawan_id NULL) tidak pernah ditolak oleh fungsi ini.
CREATE FUNCTION fn_tolak_keuangan_order_pkr() RETURNS trigger AS $fn$
DECLARE
  oid text;
  lama text;
  sumber text;
BEGIN
  IF TG_TABLE_NAME = 'OrderItem' THEN
    oid := NEW."orderId";
    IF TG_OP = 'UPDATE' THEN lama := OLD."orderId"; END IF;
  ELSE
    oid := NEW.order_id;
    IF TG_OP = 'UPDATE' THEN lama := OLD.order_id; END IF;
  END IF;
  -- UPDATE yang tidak mengubah order tidak relevan (mis. membatalkan pembayaran lama).
  IF oid IS NULL OR (TG_OP = 'UPDATE' AND lama IS NOT DISTINCT FROM oid) THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'fin_journal_lines' THEN
    SELECT e."source"::text INTO sumber FROM "fin_journal_entries" e WHERE e."id" = NEW.entry_id;
    IF sumber IS NULL OR sumber NOT IN ('PEMBAYARAN_ORDER', 'PENGAKUAN_PENDAPATAN', 'REFUND') THEN
      RETURN NEW;
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM "Order" o WHERE o."id" = oid AND o."penjualan_karyawan_id" IS NOT NULL) THEN
    RAISE EXCEPTION 'Order Penjualan Karyawan hanya dokumen operasional: % tidak boleh dibuat untuk order ini (nominal dan pembayaran dikelola di Penjualan Karyawan, Finance)', TG_TABLE_NAME USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

CREATE TRIGGER trg_payments_tolak_order_pkr BEFORE INSERT OR UPDATE OF order_id ON "payments" FOR EACH ROW EXECUTE FUNCTION fn_tolak_keuangan_order_pkr();
CREATE TRIGGER trg_invoices_tolak_order_pkr BEFORE INSERT OR UPDATE OF order_id ON "invoices" FOR EACH ROW EXECUTE FUNCTION fn_tolak_keuangan_order_pkr();
CREATE TRIGGER trg_fin_journal_lines_tolak_order_pkr BEFORE INSERT OR UPDATE OF order_id ON "fin_journal_lines" FOR EACH ROW EXECUTE FUNCTION fn_tolak_keuangan_order_pkr();
CREATE TRIGGER trg_fin_payment_allocations_tolak_order_pkr BEFORE INSERT OR UPDATE OF order_id ON "fin_payment_allocations" FOR EACH ROW EXECUTE FUNCTION fn_tolak_keuangan_order_pkr();
CREATE TRIGGER trg_order_items_tolak_order_pkr BEFORE INSERT OR UPDATE OF "orderId" ON "OrderItem" FOR EACH ROW EXECUTE FUNCTION fn_tolak_keuangan_order_pkr();
