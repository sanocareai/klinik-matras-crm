-- Production Core Slice 3 (6 September 2026) — tambah RESUME ke
-- StageLogAction. Murni ADITIF (ALTER TYPE ... ADD VALUE), tidak ada nilai
-- lama yang berubah/dihapus, tidak ada baris data yang tersentuh.
--
-- SENGAJA migrasi TERPISAH dari migrasi berikutnya (pause_reason) — pola
-- yang sama dengan Slice 2 (block_reason_extended terpisah dari
-- production_blockers): Postgres tidak mengizinkan nilai enum yang baru
-- ditambahkan dipakai di transaksi yang sama dengan ALTER TYPE-nya.
--
-- Rollback manual TIDAK tersedia untuk ALTER TYPE ADD VALUE (keterbatasan
-- Postgres) — kalau perlu, buat enum baru + migrasi kolom, bukan DROP VALUE.

-- AlterEnum
ALTER TYPE "StageLogAction" ADD VALUE 'RESUME';
