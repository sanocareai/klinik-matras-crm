-- D-032 — grup WhatsApp yang menerima ringkasan order (tombol "Kirim ke
-- Grup WA"). Pola SAMA PERSIS dengan isDriverGroup (migrasi
-- 20260801110000_sano_hub_driver_group) -- lihat catatan di schema.prisma.
--
-- Rollback manual:
--   DROP INDEX "Conversation_isSalesGroup_singleton";
--   ALTER TABLE "Conversation" DROP COLUMN "isSalesGroup";

ALTER TABLE "Conversation" ADD COLUMN "isSalesGroup" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "Conversation_isSalesGroup_singleton"
    ON "Conversation" ("isSalesGroup")
    WHERE "isSalesGroup" = true;
