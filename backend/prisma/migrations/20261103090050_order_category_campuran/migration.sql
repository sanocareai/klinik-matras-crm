-- ORDER PKR CAMPURAN (Okt 2026) — nilai enum baru untuk order Penjualan Karyawan yang memuat BARU dan LAYANAN sekaligus.
-- Sengaja BERKAS TERSENDIRI: ALTER TYPE ... ADD VALUE tidak boleh dipakai pada transaksi yang sama dengan penggunaannya. Tidak ada baris yang berubah.
-- Catatan rollback: nilai enum PostgreSQL tidak bisa dihapus. Aman dibiarkan: tak ada kode lama yang menghasilkan CAMPURAN, dan kode lama membacanya sebagai teks biasa.
ALTER TYPE "OrderCategory" ADD VALUE IF NOT EXISTS 'CAMPURAN';
