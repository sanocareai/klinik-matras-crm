-- Nonaktifkan akun (mis. sales resign) tanpa menghapus User — riwayat
-- (percakapan/order yang teratribusi) tetap utuh untuk laporan periode
-- lama. Default TRUE supaya semua akun yang sudah ada tetap aktif persis
-- seperti sebelumnya (aditif, tidak mengubah perilaku login siapa pun).
--
-- Rollback manual:
--   ALTER TABLE "User" DROP COLUMN "active";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true;
