-- Jumlah per item order PKR hingga 200 (Okt 2026): penjualan karyawan lazim 1 jenis barang dalam jumlah belasan/puluhan.
-- MELONGGARKAN batas atas CHECK dari 20 → 200. Tanpa data yang berubah (semua baris lama tetap valid), tanpa backfill, tanpa UPDATE/DELETE.
-- Komposisi komponen set (pkr_bundle_components_qty_chk) TIDAK diubah: itu isi 1 set, bukan jumlah penjualan.

ALTER TABLE "pkr_order_items" DROP CONSTRAINT "pkr_order_items_qty_chk";
ALTER TABLE "pkr_order_items" ADD CONSTRAINT "pkr_order_items_qty_chk" CHECK ("qty" >= 1 AND "qty" <= 200);
