-- Pengajuan Biaya Lintas Divisi — perbaikan arsitektur pilot Delivery
-- (rapat ulang 24 September 2026): status OTOMATIS_DISETUJUI eksplisit
-- untuk jalur auto-approve BBM/TOL/PARKIR rutin, + field "catat atas nama
-- pengaju" (requestedAt/urgentReason/sourceNote) dan klasifikasi sumber
-- dana usulan (sumberDana). Aditif murni — tidak menyentuh kolom/tabel
-- yang sudah ada, tidak ada default value yang mengubah baris lama.
-- Hand-crafted dari `prisma migrate diff` dan disaring HANYA untuk
-- statement milik slice ini — drift lain yang ikut muncul di diff mentah
-- (DROP INDEX/ALTER COLUMN DROP DEFAULT di tabel tak terkait, dari sesi
-- lain yang berjalan paralel) SENGAJA tidak disertakan di sini.

-- AlterEnum
ALTER TYPE "ExpenseSubmissionStatus" ADD VALUE 'OTOMATIS_DISETUJUI';

-- AlterTable
ALTER TABLE "expense_submissions"
  ADD COLUMN "requested_at" TIMESTAMP(3),
  ADD COLUMN "urgent_reason" TEXT,
  ADD COLUMN "source_note" TEXT,
  ADD COLUMN "sumber_dana" TEXT;
