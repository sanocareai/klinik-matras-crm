-- Deskripsi bahan bebas teks (merek, isi kemasan, cara pakai). Informasi saja: tidak dipakai perhitungan stok, harga, konversi, atau deteksi SKU kembar.
ALTER TABLE "materials" ADD COLUMN "description" TEXT;
