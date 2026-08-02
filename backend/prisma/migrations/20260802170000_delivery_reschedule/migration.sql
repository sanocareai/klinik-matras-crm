-- Delivery Tahap 5 — reschedule setelah job gagal.
--
-- GAP FUNGSIONAL NYATA: sebelum ini, job berstatus FAILED adalah jalan buntu.
-- PATCH /jobs/:id menolak apa pun selain UNSCHEDULED/SCHEDULED/ASSIGNED —
-- tidak ada cara menjadwalkan ulang job yang gagal tanpa membuat job baru
-- dari nol (dan kehilangan jejak kegagalan aslinya di job lama).
--
-- rescheduleReason TERPISAH dari failureReason yang sudah ada: "kenapa gagal"
-- dan "kenapa dijadwalkan ulang" adalah dua pertanyaan berbeda (gagal karena
-- pelanggan tak di tempat; dijadwalkan ulang karena pelanggan minta besok
-- siang) — menimpa failureReason akan menghapus jejak kegagalan aslinya.
--
-- ADITIF MURNI: 4 kolom nullable + 1 boolean default false. `jobs` masih
-- kosong di production saat migrasi ini ditulis (sama seperti tiga migrasi
-- Delivery sebelumnya) — nol data yang perlu ditebak.

ALTER TABLE "jobs" ADD COLUMN "reschedule_reason"              TEXT;
ALTER TABLE "jobs" ADD COLUMN "rescheduled_at"                 TIMESTAMP(3);
ALTER TABLE "jobs" ADD COLUMN "rescheduled_by"                 TEXT;
ALTER TABLE "jobs" ADD COLUMN "customer_confirmed_reschedule"  BOOLEAN NOT NULL DEFAULT false;

-- SetNull: dispatcher resign, riwayat reschedule TETAP ada — pola yang sama
-- dengan seluruh aktor lain di sistem ini.
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_rescheduled_by_fkey"
    FOREIGN KEY ("rescheduled_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
