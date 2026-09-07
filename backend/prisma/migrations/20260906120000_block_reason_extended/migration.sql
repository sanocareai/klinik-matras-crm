-- Production Core Slice 2 (6 September 2026) — perluas BlockReason. Murni
-- ADITIF (ALTER TYPE ... ADD VALUE), tidak ada nilai lama yang berubah/
-- dihapus, tidak ada baris data yang tersentuh.
--
-- SENGAJA migrasi TERPISAH dari pembuatan tabel production_blockers
-- (migration berikutnya) — Postgres tidak mengizinkan nilai enum yang baru
-- ditambahkan dipakai di transaksi yang sama dengan ALTER TYPE-nya. Tabel
-- production_blockers akan punya kolom bertipe "BlockReason", jadi
-- perluasan tipe ini harus SUDAH committed lebih dulu.
--
-- Rollback manual TIDAK tersedia untuk ALTER TYPE ADD VALUE (keterbatasan
-- Postgres) — kalau perlu, buat enum baru + migrasi kolom, bukan DROP VALUE.

-- AlterEnum
ALTER TYPE "BlockReason" ADD VALUE 'AWAITING_CUSTOMER';
ALTER TYPE "BlockReason" ADD VALUE 'AWAITING_OPERATOR';
ALTER TYPE "BlockReason" ADD VALUE 'AWAITING_TOOL';
