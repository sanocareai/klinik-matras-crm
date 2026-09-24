-- PIN step-up untuk koreksi finansial. Aditif: kolom baru pada "User", tidak ada data lama yang berubah.
ALTER TABLE "User"
  ADD COLUMN "finance_pin_hash" TEXT,
  ADD COLUMN "finance_pin_failed" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "finance_pin_locked_until" TIMESTAMP(3),
  ADD COLUMN "finance_pin_set_at" TIMESTAMP(3);
