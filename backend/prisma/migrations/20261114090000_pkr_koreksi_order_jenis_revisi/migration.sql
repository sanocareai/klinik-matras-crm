-- KOREKSI ORDER PENJUALAN KARYAWAN: buku revisi append-only menerima jenis baru — ORDER_ADMIN (perbaikan data administratif dengan snapshot sebelum/sesudah),
-- TAMBAHAN (tambahan permintaan customer: item/unit baru + jurnal delta), ADOPSI (order lama dicatat sebagai item pesanan awal; unit yang ada ditautkan, tidak diubah),
-- NILAI (koreksi harga baris catatan lama; jurnal delta). Hanya melonggarkan CHECK jenis; tanpa backfill, tanpa UPDATE/DELETE baris.

ALTER TABLE "pkr_item_revisions" DROP CONSTRAINT "pkr_item_revisions_kind_chk";
ALTER TABLE "pkr_item_revisions" ADD CONSTRAINT "pkr_item_revisions_kind_chk" CHECK ("kind" IN ('DIBUAT', 'DILENGKAPI', 'DIKOREKSI', 'PEMBELI', 'ORDER_ADMIN', 'TAMBAHAN', 'ADOPSI', 'NILAI'));
