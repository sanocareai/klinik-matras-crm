-- Delivery Tahap 6 — "Retur" (disebut Revisi secara internal, lihat catatan
-- panjang di schema.prisma di atas model UnitRevision).
--
-- KOREKSI dari spesifikasi asli: bukan refund/replace/reject. Kalau customer
-- merasa tekstur kasur kurang pas dalam masa trial (7/30 hari), atau ada
-- klaim garansi amblas (10/20 tahun), tim membawa kembali kasurnya, merevisi
-- (adjust lapisan/racikan), lalu mengantar ulang — diulang sampai customer
-- puas. Tabel baru karena satu Unit bisa punya BEBERAPA percobaan revisi.
--
-- ADITIF MURNI, tabel baru sepenuhnya — tidak menyentuh kolom yang sudah ada.

CREATE TYPE "RevisionTrigger" AS ENUM ('KENYAMANAN', 'GARANSI');

CREATE TYPE "RevisionStatus" AS ENUM (
  'REQUESTED', 'PICKUP_SCHEDULED', 'IN_REWORK', 'READY_REDELIVER',
  'REDELIVERED', 'CONFIRMED', 'CANCELLED'
);

CREATE TABLE "unit_revisions" (
    "id"           UUID NOT NULL,
    "unit_id"      UUID NOT NULL,
    "trigger"      "RevisionTrigger" NOT NULL,
    "complaint"    TEXT NOT NULL,
    "status"       "RevisionStatus" NOT NULL DEFAULT 'REQUESTED',
    "job_id"       UUID,
    "note"         TEXT,
    "confirmed_at" TIMESTAMP(3),
    "created_by"   TEXT,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "unit_revisions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "unit_revisions_unit_id_idx" ON "unit_revisions"("unit_id");
CREATE INDEX "unit_revisions_status_idx" ON "unit_revisions"("status");

ALTER TABLE "unit_revisions" ADD CONSTRAINT "unit_revisions_unit_id_fkey"
    FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "unit_revisions" ADD CONSTRAINT "unit_revisions_job_id_fkey"
    FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "unit_revisions" ADD CONSTRAINT "unit_revisions_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
