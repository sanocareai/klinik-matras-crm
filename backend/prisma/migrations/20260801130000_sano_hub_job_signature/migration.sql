-- Sano Hub Phase 2 — tanda tangan customer saat job selesai. Opsional,
-- lapisan kepercayaan tambahan di atas foto bukti yang tetap wajib.

-- AlterTable
ALTER TABLE "jobs" ADD COLUMN "signature_url" TEXT;
