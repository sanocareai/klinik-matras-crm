-- Sano Hub Phase 1 — Revisi Scope (PRD §7.4 / FR-R, D-008).
--
-- Kejadian paling umum di restorasi kasur: kasur dibongkar, kondisi aslinya
-- lebih parah dari dugaan survei, harga harus berubah. Hari ini dinegosiasikan
-- lewat WhatsApp lalu hilang — dan total order diam-diam menyimpang dari yang
-- benar-benar ditagih.
--
-- ADITIF MURNI: satu tabel + dua enum baru, tidak ada kolom lama yang diubah
-- atau data lama yang disentuh. Tidak ada backfill — revisi hanya bermakna
-- untuk unit yang bergerak SETELAH ini ada; mengarang revisi historis akan
-- mengotori metrik revision-rate (FR-R-06) sejak hari pertama.

-- CreateEnum
CREATE TYPE "ScopeRevisionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'PARTIAL');

-- CreateEnum
CREATE TYPE "ScopeRevisionVia" AS ENUM ('WHATSAPP', 'TELEPON', 'LANGSUNG', 'LAINNYA');

-- CreateTable
CREATE TABLE "scope_revisions" (
    "id"              UUID    NOT NULL,
    "unit_id"         UUID    NOT NULL,
    "order_id"        TEXT    NOT NULL,
    "stage_id"        UUID,
    "from_service_id" UUID,
    "to_service_id"   UUID,
    "reason"          TEXT    NOT NULL,
    "delta_amount"    INTEGER NOT NULL,
    "photo_urls"      TEXT[]  DEFAULT ARRAY[]::TEXT[],
    "status"          "ScopeRevisionStatus" NOT NULL DEFAULT 'PENDING',
    "decided_by"      TEXT,
    "decided_at"      TIMESTAMP(3),
    "decided_via"     "ScopeRevisionVia",
    "evidence_url"    TEXT,
    "decision_note"   TEXT,
    "order_item_id"   TEXT,
    "created_by"      TEXT,
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scope_revisions_pkey" PRIMARY KEY ("id")
);

-- Papan "menunggu jawaban customer" + FR-R-06 (revision rate per tahap).
CREATE INDEX "scope_revisions_unit_id_created_at_idx" ON "scope_revisions"("unit_id", "created_at");
CREATE INDEX "scope_revisions_order_id_idx"           ON "scope_revisions"("order_id");
CREATE INDEX "scope_revisions_status_idx"             ON "scope_revisions"("status");
CREATE INDEX "scope_revisions_stage_id_idx"           ON "scope_revisions"("stage_id");

-- RESTRICT ke unit & order: menghapus kasur/order yang punya riwayat
-- negosiasi harga harus GAGAL KERAS, bukan menghapus jejaknya diam-diam.
-- Alasan yang sama dengan FK Unit→Order.
ALTER TABLE "scope_revisions" ADD CONSTRAINT "scope_revisions_unit_id_fkey"
    FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "scope_revisions" ADD CONSTRAINT "scope_revisions_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Tahap boleh dinonaktifkan/diganti tanpa menghancurkan riwayat revisi.
ALTER TABLE "scope_revisions" ADD CONSTRAINT "scope_revisions_stage_id_fkey"
    FOREIGN KEY ("stage_id") REFERENCES "routing_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RESTRICT ke katalog layanan: layanan yang pernah dipakai di negosiasi harga
-- tidak boleh hilang — kalau hilang, "dari layanan apa ke apa" jadi tidak
-- terbaca dan bukti perubahan harganya kehilangan artinya.
ALTER TABLE "scope_revisions" ADD CONSTRAINT "scope_revisions_from_service_id_fkey"
    FOREIGN KEY ("from_service_id") REFERENCES "service_catalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "scope_revisions" ADD CONSTRAINT "scope_revisions_to_service_id_fkey"
    FOREIGN KEY ("to_service_id") REFERENCES "service_catalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- SetNull untuk aktor: pegawai resign, riwayat operasional TETAP ada —
-- pola yang sama dengan unit_stage_logs & stock_movements.
ALTER TABLE "scope_revisions" ADD CONSTRAINT "scope_revisions_decided_by_fkey"
    FOREIGN KEY ("decided_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "scope_revisions" ADD CONSTRAINT "scope_revisions_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
