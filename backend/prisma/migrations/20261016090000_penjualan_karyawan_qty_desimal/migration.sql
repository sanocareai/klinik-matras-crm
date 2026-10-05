-- Jumlah item Penjualan Karyawan boleh pecahan (mis. 1,6 meter/kg). ADITIF terhadap data: nilai bulat lama identik (5 -> 5.000), tidak ada baris yang dihapus/diubah artinya.
-- Hanya tabel fin_penjualan_karyawan_items (kecil, ~20 baris saat rilis). CHECK menjaga jumlah > 0 di level database (API juga menolak).
ALTER TABLE "fin_penjualan_karyawan_items" ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(12,3);
ALTER TABLE "fin_penjualan_karyawan_items" ADD CONSTRAINT "fin_penjualan_karyawan_items_qty_chk" CHECK ("quantity" > 0);
