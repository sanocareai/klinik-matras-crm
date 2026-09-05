-- Route Planner redesign (Sep 2026, docs/ARMADA-REDESIGN-2026.md) — rute
-- PUBLISHED tetap terkunci secara DEFAULT (immutability = komitmen ke
-- driver), tapi dispatcher kadang perlu edit mendadak (perubahan jadwal
-- customer di menit akhir). Kolom ini jejak "siapa mengedit apa terakhir
-- kali, kapan, kenapa" — kolom biasa (bukan ledger append-only), sama
-- penyimpangan sadar dengan Job.podStatus: cukup untuk v1.
ALTER TABLE "routes" ADD COLUMN "last_edit_reason" TEXT;
ALTER TABLE "routes" ADD COLUMN "last_edited_at" TIMESTAMP(3);
ALTER TABLE "routes" ADD COLUMN "last_edited_by" TEXT;

ALTER TABLE "routes" ADD CONSTRAINT "routes_last_edited_by_fkey"
    FOREIGN KEY ("last_edited_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;