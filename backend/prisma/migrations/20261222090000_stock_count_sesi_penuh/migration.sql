-- STOCK OPNAME SESI PENUH (Okt 2026) — migrasi ADITIF: kolom baru yang NULL/ber-default pada stock_counts dan stock_count_lines. Tanpa backfill, tanpa perubahan data lama, tanpa constraint/indeks unik baru
-- yang bisa gagal pada data lama. Sesi lama (termasuk yang berisi 106 bahan) tetap model_version = 1 dan dibaca dengan aturan lama; hanya sesi yang dibuat lewat alur baru bermodel 2
-- (cakupan tersimpan, waktu hitung per bahan, revisi per baris). Keunikan bahan per sesi baru dijaga di kode (dibuat dari himpunan Material ID tanpa duplikat).

ALTER TABLE "stock_counts"
  ADD COLUMN "model_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "scope_mode" VARCHAR(10),
  ADD COLUMN "scope_info" JSONB;

ALTER TABLE "stock_count_lines"
  ADD COLUMN "counted_at" TIMESTAMP(3),
  ADD COLUMN "counted_by_id" TEXT,
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "needs_check" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "excluded_reason" TEXT,
  ADD COLUMN "excluded_at" TIMESTAMP(3),
  ADD COLUMN "excluded_by_id" TEXT,
  ADD COLUMN "origin" VARCHAR(10) NOT NULL DEFAULT 'SESI';

ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_model_version_chk" CHECK ("model_version" IN (1, 2));
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_scope_mode_chk" CHECK ("scope_mode" IS NULL OR "scope_mode" IN ('FULL', 'GROUP', 'ITEMS'));
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_origin_chk" CHECK ("origin" IN ('SESI', 'TAMBAHAN'));
