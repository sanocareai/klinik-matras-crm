-- CATATAN PEMAKAIAN HISTORIS (Okt 2026). ADITIF: hanya CREATE TABLE/INDEX/FUNCTION/TRIGGER baru. Tidak mengubah tabel yang ada, tidak menulis data.
-- usage_import_batches : satu baris per berkas sumber (sidik jari sha256) — impor ulang berkas yang sama menemukan batch yang sama (idempoten).
-- unit_usage_notes     : catatan pemakaian bahan per order/unit dari sumber historis (Excel Admin Sales). BUKAN stock_movements / Material Issue: tidak mengurangi saldo, tidak ada biaya, tidak ada jurnal.
--                        Nilai ASLI berkas (raw_*) tidak dapat diubah (trigger). Angka janggal tidak diperbaiki otomatis; hanya ditandai (flags) "Perlu dicek".
--                        origin='LEDGER' = pergerakan ISSUE lama yang tidak punya pasangan di Excel (ditandai agar terlihat; pergerakannya sendiri tidak disentuh).
-- unit_usage_note_events : jejak append-only atas setiap perubahan keadaan/tautan/koreksi catatan (sebelum–sesudah, alasan, pelaku, waktu).

CREATE TABLE "usage_import_batches" (
  "id" UUID NOT NULL,
  "source_kind" TEXT NOT NULL,
  "file_name" TEXT NOT NULL,
  "file_sha256" TEXT NOT NULL,
  "row_count" INTEGER NOT NULL,
  "summary" JSONB NOT NULL DEFAULT '{}',
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "usage_import_batches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "usage_import_batches_kind_chk" CHECK ("source_kind" IN ('EXCEL_ADMIN_SALES_CSV')),
  CONSTRAINT "usage_import_batches_sha_chk" CHECK ("file_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "usage_import_batches_rows_chk" CHECK ("row_count" >= 0)
);
CREATE UNIQUE INDEX "usage_import_batches_source_kind_file_sha256_key" ON "usage_import_batches"("source_kind", "file_sha256");

CREATE TABLE "unit_usage_notes" (
  "id" UUID NOT NULL,
  "batch_id" UUID NOT NULL,
  "origin" TEXT NOT NULL,
  "source_key" TEXT NOT NULL,
  "source_row" INTEGER,
  "order_number" TEXT NOT NULL,
  "order_id" TEXT,
  "unit_id" UUID,
  "raw_name" TEXT,
  "raw_spec" TEXT,
  "raw_qty" TEXT,
  "raw_uom" TEXT,
  "raw_category" TEXT,
  "raw_date" TEXT,
  "raw_month" TEXT,
  "raw_pic" TEXT,
  "raw_qc" TEXT,
  "raw_price" TEXT,
  "raw_total" TEXT,
  "raw_row" JSONB,
  "qty" DECIMAL(14,4),
  "uom" TEXT,
  "used_at" TIMESTAMP(3),
  "material_id" UUID,
  "map_via" TEXT,
  "state" TEXT NOT NULL,
  "flags" JSONB NOT NULL DEFAULT '[]',
  "stock_movement_id" UUID,
  "link_kind" TEXT,
  "evaluated_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "unit_usage_notes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "unit_usage_notes_origin_chk" CHECK ("origin" IN ('EXCEL','LEDGER')),
  CONSTRAINT "unit_usage_notes_state_chk" CHECK ("state" IN ('TERCATAT_DI_STOK','PERLU_DICEK','SIAP_POSTING','DIPOSTING','BUKAN_STOK','TIDAK_DIHITUNG','DIKOREKSI')),
  CONSTRAINT "unit_usage_notes_link_chk" CHECK ("link_kind" IS NULL OR "link_kind" IN ('ISSUE_LAMA_SAMA','ISSUE_LAMA_BEDA','POSTING_HISTORIS','ISSUE_TANPA_PASANGAN')),
  CONSTRAINT "unit_usage_notes_flags_chk" CHECK (jsonb_typeof("flags") = 'array'),
  CONSTRAINT "unit_usage_notes_excel_chk" CHECK ("origin" <> 'EXCEL' OR ("source_row" IS NOT NULL AND "raw_row" IS NOT NULL)),
  CONSTRAINT "unit_usage_notes_ledger_chk" CHECK ("origin" <> 'LEDGER' OR "stock_movement_id" IS NOT NULL),
  CONSTRAINT "unit_usage_notes_posted_chk" CHECK ("state" <> 'DIPOSTING' OR ("stock_movement_id" IS NOT NULL AND "link_kind" = 'POSTING_HISTORIS')),
  CONSTRAINT "unit_usage_notes_stock_chk" CHECK ("state" <> 'TERCATAT_DI_STOK' OR "stock_movement_id" IS NOT NULL),
  CONSTRAINT "unit_usage_notes_siap_chk" CHECK ("state" <> 'SIAP_POSTING' OR ("unit_id" IS NOT NULL AND "material_id" IS NOT NULL AND "qty" IS NOT NULL AND "qty" > 0 AND "uom" IS NOT NULL AND "used_at" IS NOT NULL AND "stock_movement_id" IS NULL))
);
CREATE UNIQUE INDEX "unit_usage_notes_source_key_key" ON "unit_usage_notes"("source_key");
CREATE INDEX "unit_usage_notes_unit_id_idx" ON "unit_usage_notes"("unit_id");
CREATE INDEX "unit_usage_notes_order_number_idx" ON "unit_usage_notes"("order_number");
CREATE INDEX "unit_usage_notes_state_idx" ON "unit_usage_notes"("state");
CREATE INDEX "unit_usage_notes_material_id_idx" ON "unit_usage_notes"("material_id");
CREATE INDEX "unit_usage_notes_batch_id_idx" ON "unit_usage_notes"("batch_id");
CREATE INDEX "unit_usage_notes_stock_movement_id_idx" ON "unit_usage_notes"("stock_movement_id");
ALTER TABLE "unit_usage_notes" ADD CONSTRAINT "unit_usage_notes_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "usage_import_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "unit_usage_notes" ADD CONSTRAINT "unit_usage_notes_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "unit_usage_notes" ADD CONSTRAINT "unit_usage_notes_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "unit_usage_notes" ADD CONSTRAINT "unit_usage_notes_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "unit_usage_notes" ADD CONSTRAINT "unit_usage_notes_stock_movement_id_fkey" FOREIGN KEY ("stock_movement_id") REFERENCES "stock_movements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "unit_usage_note_events" (
  "id" UUID NOT NULL,
  "note_id" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "before" JSONB,
  "after" JSONB,
  "reason" TEXT,
  "actor_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "unit_usage_note_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "unit_usage_note_events_kind_chk" CHECK ("kind" IN ('IMPOR','DITAUTKAN','DIEVALUASI','DIKOREKSI','DIPOSTING','DIKECUALIKAN')),
  CONSTRAINT "unit_usage_note_events_reason_chk" CHECK ("kind" NOT IN ('DIKOREKSI','DIKECUALIKAN') OR ("reason" IS NOT NULL AND length(btrim("reason")) >= 3))
);
CREATE INDEX "unit_usage_note_events_note_id_created_at_idx" ON "unit_usage_note_events"("note_id", "created_at");
ALTER TABLE "unit_usage_note_events" ADD CONSTRAINT "unit_usage_note_events_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "unit_usage_notes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Penjaga catatan: tidak boleh dihapus; kolom asal (identitas + nilai asli berkas) tidak boleh berubah.
-- Yang boleh berubah (selalu disertai peristiwa di aplikasi): nilai teruraikan (qty/uom/used_at/material_id/map_via), state, flags, tautan pergerakan, unit_id (hanya NULL -> terisi), evaluasi.
CREATE OR REPLACE FUNCTION unit_usage_notes_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'unit_usage_notes tidak boleh dihapus (riwayat catatan pemakaian)'; END IF;
  IF NEW.id <> OLD.id OR NEW.batch_id <> OLD.batch_id OR NEW.origin <> OLD.origin OR NEW.source_key <> OLD.source_key OR NEW.source_row IS DISTINCT FROM OLD.source_row
     OR NEW.order_number <> OLD.order_number OR NEW.order_id IS DISTINCT FROM OLD.order_id OR NEW.created_at <> OLD.created_at
     OR NEW.raw_name IS DISTINCT FROM OLD.raw_name OR NEW.raw_spec IS DISTINCT FROM OLD.raw_spec OR NEW.raw_qty IS DISTINCT FROM OLD.raw_qty OR NEW.raw_uom IS DISTINCT FROM OLD.raw_uom
     OR NEW.raw_category IS DISTINCT FROM OLD.raw_category OR NEW.raw_date IS DISTINCT FROM OLD.raw_date OR NEW.raw_month IS DISTINCT FROM OLD.raw_month OR NEW.raw_pic IS DISTINCT FROM OLD.raw_pic
     OR NEW.raw_qc IS DISTINCT FROM OLD.raw_qc OR NEW.raw_price IS DISTINCT FROM OLD.raw_price OR NEW.raw_total IS DISTINCT FROM OLD.raw_total OR NEW.raw_row IS DISTINCT FROM OLD.raw_row THEN
    RAISE EXCEPTION 'nilai asli catatan pemakaian historis (raw_*) dan identitasnya tidak boleh diubah';
  END IF;
  IF OLD.unit_id IS NOT NULL AND NEW.unit_id IS DISTINCT FROM OLD.unit_id THEN RAISE EXCEPTION 'unit catatan pemakaian historis tidak boleh diubah setelah terisi'; END IF;
  IF OLD.stock_movement_id IS NOT NULL AND NEW.stock_movement_id IS DISTINCT FROM OLD.stock_movement_id THEN RAISE EXCEPTION 'tautan pergerakan stok catatan pemakaian historis tidak boleh diubah setelah terisi'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER "unit_usage_notes_guard_trg" BEFORE UPDATE OR DELETE ON "unit_usage_notes" FOR EACH ROW EXECUTE FUNCTION unit_usage_notes_guard();

CREATE OR REPLACE FUNCTION unit_usage_note_events_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'unit_usage_note_events append-only: tidak boleh diubah atau dihapus';
END $$ LANGUAGE plpgsql;
CREATE TRIGGER "unit_usage_note_events_guard_trg" BEFORE UPDATE OR DELETE ON "unit_usage_note_events" FOR EACH ROW EXECUTE FUNCTION unit_usage_note_events_guard();
