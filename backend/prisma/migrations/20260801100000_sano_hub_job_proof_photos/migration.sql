-- Sano Hub Phase 1 — foto bukti pickup/delivery + foto kegagalan di Job.
--
-- Gap yang ditemukan saat membangun Armada: migrasi Job sebelumnya
-- (20260731130000) menyiapkan failureReason (teks) tapi TIDAK ada kolom foto
-- sama sekali — padahal PRD FR-D-07 eksplisit: "every failure requires a
-- reason code AND a photo, no exceptions", dan FR-D-03/FR-D-04 juga minta
-- foto kondisi/penempatan saat pickup/delivery BERHASIL. Aditif, tidak
-- mengubah kolom yang sudah ada.
--
-- Rollback manual:
--   ALTER TABLE "jobs" DROP COLUMN "proof_photo_urls", DROP COLUMN "failure_photo_urls";

ALTER TABLE "jobs"
    ADD COLUMN "proof_photo_urls"   TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN "failure_photo_urls" TEXT[] NOT NULL DEFAULT '{}';
