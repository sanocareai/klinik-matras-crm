-- Gerbang redelivery pada ComplaintCase (31 Oktober 2026, insiden Sony RES-27082026-183).
-- ADITIF murni: 3 kolom nullable baru + 1 FK opsional. Tidak mengubah/menghapus kolom lama,
-- tidak butuh backfill (semua kasus lama otomatis redeliveryWaivedAt = NULL, artinya "belum
-- diputuskan untuk dilewati" — gerbang tetap berlaku apa adanya untuk kasus lama).

ALTER TABLE "complaint_cases"
  ADD COLUMN "redelivery_waived_at" TIMESTAMP(3),
  ADD COLUMN "redelivery_waived_by" TEXT,
  ADD COLUMN "redelivery_waived_reason" TEXT;

ALTER TABLE "complaint_cases"
  ADD CONSTRAINT "complaint_cases_redelivery_waived_by_fkey"
  FOREIGN KEY ("redelivery_waived_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
