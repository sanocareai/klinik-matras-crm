-- Sano Hub Phase 1 — grup WhatsApp driver yang ditugaskan (D-018).
--
-- Workflow Gilang (31 Juli 2026): "penjemputan dan pengambilan terdokumentasi
-- di grup driver whatsapp". Tidak ada mekanisme "grup yang ditugaskan" di
-- skema sebelum ini — Conversation type=GROUP sudah ada (Grup Sales, Grup
-- Driver, Grup Produksi disebut di CLAUDE.md §"Konsep baru"), tapi tidak ada
-- cara menandai MANA yang "Grup Driver".
--
-- Sengaja BOOLEAN sederhana, bukan tabel setting terpisah — satu grup yang
-- ditugaskan sudah cukup untuk v1 (Gilang menyebut satu grup, bukan
-- beberapa). ADMIN yang menandainya lewat PUT /api/armada/driver-group,
-- SEKALI di awal, bukan dipilih ulang tiap kali driver menyelesaikan job.
--
-- NAMA KOLOM camelCase ("isDriverGroup"), BUKAN snake_case — model
-- Conversation ini TIDAK memakai @map/@@map sama sekali (beda dari tabel
-- Sano Hub yang lebih baru), jadi ikut konvensi tabel ini SUPAYA konsisten,
-- bukan konvensi migrasi Sano Hub yang lain.
--
-- Rollback manual:
--   ALTER TABLE "Conversation" DROP COLUMN "isDriverGroup";

ALTER TABLE "Conversation" ADD COLUMN "isDriverGroup" BOOLEAN NOT NULL DEFAULT false;

-- Partial unique index: HANYA SATU conversation boleh true di satu waktu.
-- Mencegah dua grup sama-sama ditandai "Grup Driver" secara tidak sengaja,
-- yang akan membuat dokumentasi terpecah tanpa disadari.
CREATE UNIQUE INDEX "Conversation_isDriverGroup_singleton"
    ON "Conversation" ("isDriverGroup")
    WHERE "isDriverGroup" = true;
