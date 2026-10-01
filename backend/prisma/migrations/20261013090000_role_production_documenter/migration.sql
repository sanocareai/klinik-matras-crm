-- P10B (Aplikasi Dokumentasi): satu role baru, additive. Tidak ada pengguna yang diberi role ini otomatis.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'PRODUCTION_DOCUMENTER';
