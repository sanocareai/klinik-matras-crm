-- REFUND PENGURANGAN NILAI ORDER (Okt 2026, keputusan Owner 12 Okt 2026).
-- MIGRASI ADITIF: kolom baru dengan default aman + indeks. Tidak ada baris lama yang diubah/dihapus, tidak ada backfill.
--
--   fin_refunds.kurangi_nilai_order : true = refund ini membatalkan sebagian pesanan (mis. "triplek tidak jadi dipakai"): saat DISETUJUI nilai order ikut
--                                     berkurang sebesar nominal refund (lewat satu baris OrderItem pengurang yang terkunci), jadi order yang sudah Lunas tetap Lunas.
--                                     false (default) = pengembalian dana biasa, nilai order TIDAK berubah (perilaku lama PERSIS; semua refund yang ada tetap false).
--   OrderItem.fin_refund_id         : penanda baris pengurang milik refund tsb (NULL untuk semua item biasa). Baris ini tidak bisa diedit/dihapus Sales; hanya
--                                     dibalik otomatis saat refund dibatalkan/dikoreksi. Wajib bernilai NEGATIF (CHECK di bawah).

ALTER TABLE "fin_refunds" ADD COLUMN "kurangi_nilai_order" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "OrderItem" ADD COLUMN "fin_refund_id" UUID;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_fin_refund_id_fkey" FOREIGN KEY ("fin_refund_id") REFERENCES "fin_refunds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_fin_refund_negatif_chk" CHECK ("fin_refund_id" IS NULL OR "harga" < 0);
CREATE INDEX "OrderItem_fin_refund_id_idx" ON "OrderItem"("fin_refund_id");
