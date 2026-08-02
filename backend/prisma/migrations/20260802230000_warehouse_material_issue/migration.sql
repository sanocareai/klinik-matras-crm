-- Warehouse Tahap 3 — Material Issue (request → approval → picking → issue).
--
-- KENAPA. v1 inventory cuma punya POST /movements/issue — satu langkah,
-- WAJIB unit_id, langsung tercatat ke ledger. Itu TIDAK diubah (tetap
-- jalur "keluarkan material ke unit produksi tertentu, sekarang juga").
-- Production sekarang butuh alur REQUEST → APPROVAL → PICKING → ISSUE untuk
-- kebutuhan yang belum tentu terikat satu Unit (maintenance, sample,
-- kebutuhan line umum) dan perlu di-approve sebelum barang keluar.
--
-- INI YANG MEMBUAT "Reserved" JADI NYATA. Reserved dihitung on-the-fly
-- sebagai SUM(requested_qty) atas baris yang induknya berstatus
-- APPROVED/READY_TO_PICK/PICKED — BUKAN kolom tersimpan. DRAFT dan
-- WAITING_APPROVAL belum mereservasi apa pun (masih permintaan, bukan
-- komitmen gudang). Begitu ISSUED, baris stock_movements ISSUE ditulis dan
-- reservasinya otomatis lepas karena statusnya sudah bukan tiga itu lagi.
--
-- AMAN SEKARANG: stock_movements masih KOSONG di production.

CREATE TYPE "IssueSourceType" AS ENUM (
  'PRODUCTION_WORK_ORDER', 'MAINTENANCE_REQUEST', 'INTERNAL_REQUEST',
  'SAMPLE_REQUEST', 'MANUAL'
);

CREATE TYPE "IssueStatus" AS ENUM (
  'DRAFT', 'WAITING_APPROVAL', 'APPROVED', 'READY_TO_PICK', 'PICKED', 'ISSUED', 'CANCELLED'
);

CREATE TYPE "IssuePriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

CREATE TABLE "material_issues" (
    "id"               UUID NOT NULL,
    "issue_number"     TEXT NOT NULL,
    "source_type"      "IssueSourceType" NOT NULL,
    "source_reference" TEXT,
    "department"       TEXT,
    "requested_by"     TEXT,
    "required_date"    DATE,
    "priority"         "IssuePriority" NOT NULL DEFAULT 'NORMAL',
    "notes"            TEXT,
    "status"           "IssueStatus" NOT NULL DEFAULT 'DRAFT',
    "approved_by"      TEXT,
    "approved_at"      TIMESTAMP(3),
    "issued_by"        TEXT,
    "issued_at"        TIMESTAMP(3),
    "created_by"       TEXT,
    "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMP(3) NOT NULL,

    CONSTRAINT "material_issues_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "material_issues_issue_number_key" ON "material_issues"("issue_number");
CREATE INDEX "material_issues_status_idx" ON "material_issues"("status");
CREATE INDEX "material_issues_required_date_idx" ON "material_issues"("required_date");

CREATE TABLE "material_issue_lines" (
    "id"                UUID NOT NULL,
    "material_issue_id" UUID NOT NULL,
    "material_id"       UUID NOT NULL,
    "requested_qty"     DOUBLE PRECISION NOT NULL,
    "issued_qty"        DOUBLE PRECISION,
    "source_location"   TEXT,
    "notes"             TEXT,

    CONSTRAINT "material_issue_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "material_issue_lines_material_issue_id_idx" ON "material_issue_lines"("material_issue_id");
CREATE INDEX "material_issue_lines_material_id_idx" ON "material_issue_lines"("material_id");

ALTER TABLE "material_issues" ADD CONSTRAINT "material_issues_requested_by_fkey"
    FOREIGN KEY ("requested_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "material_issues" ADD CONSTRAINT "material_issues_approved_by_fkey"
    FOREIGN KEY ("approved_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "material_issues" ADD CONSTRAINT "material_issues_issued_by_fkey"
    FOREIGN KEY ("issued_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "material_issues" ADD CONSTRAINT "material_issues_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "material_issue_lines" ADD CONSTRAINT "material_issue_lines_material_issue_id_fkey"
    FOREIGN KEY ("material_issue_id") REFERENCES "material_issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "material_issue_lines" ADD CONSTRAINT "material_issue_lines_material_id_fkey"
    FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_movements" ADD COLUMN "material_issue_id" UUID;
CREATE INDEX "stock_movements_material_issue_id_idx" ON "stock_movements"("material_issue_id");
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_material_issue_id_fkey"
    FOREIGN KEY ("material_issue_id") REFERENCES "material_issues"("id") ON DELETE SET NULL ON UPDATE CASCADE;
