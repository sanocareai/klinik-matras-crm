-- Kasbon (uang muka gaji karyawan) sebagai sumber jurnal sendiri —
-- lihat services/finance/posting/kasbon.js. Piutang Karyawan (1-1350)
-- sudah ada dari migrasi finance_workspace_ledger, tapi belum ada nilai
-- FinJournalSource untuk membedakan jurnal kasbon dari jurnal manual biasa
-- di laporan Jurnal Umum. Murni ADITIF (ALTER TYPE ... ADD VALUE), tidak
-- ada nilai lama yang berubah/dihapus, tidak ada baris data yang tersentuh.
--
-- Rollback manual TIDAK tersedia untuk ALTER TYPE ADD VALUE (keterbatasan
-- Postgres) — kalau perlu, buat enum baru + migrasi kolom, bukan DROP VALUE.

-- AlterEnum
ALTER TYPE "FinJournalSource" ADD VALUE 'KASBON';
