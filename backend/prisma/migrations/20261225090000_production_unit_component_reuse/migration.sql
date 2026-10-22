-- KOMPONEN LAMA DARI UNIT PELANGGAN (Okt 2026): pencatatan pemakaian kembali komponen bongkaran milik kasur pelanggan yang sedang dikerjakan. ADITIF: hanya CREATE TABLE/INDEX/TRIGGER baru.
-- BUKAN stok perusahaan: tabel ini TIDAK menulis stock_movements / material_issues / reservasi / jurnal / biaya bahan baru, dan TIDAK ada kolom saldo. Komponen lama milik pelanggan.
-- Append-only (versi): salah input = baris versi baru (CORRECTED/VOIDED) dengan alasan wajib; baris lama TIDAK diubah/dihapus (trigger memakai fungsi production_adopsi_append_only() yang sudah ada live).
-- source dikunci 'OWN_UNIT': komponen dari unit pelanggan LAIN tidak dapat dicatat lewat jalur ini (kasus lintas unit butuh alur persetujuan + kepemilikan tersendiri).
-- outcome: REUSED (dipakai kembali, pemakaian) | RETURNED_TO_CUSTOMER | KEPT_WITH_UNIT | DISCARDED (dilepas tetapi TIDAK dipakai: bukan pemakaian dan tidak otomatis masuk stok).

CREATE TABLE "unit_component_reuse_entries" (
  "id" UUID NOT NULL,
  "item_id" UUID NOT NULL,
  "unit_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'OWN_UNIT',
  "name" TEXT NOT NULL,
  "material_id" UUID,
  "qty" DECIMAL(12,4) NOT NULL,
  "uom" TEXT NOT NULL,
  "condition" TEXT,
  "work_part" TEXT,
  "outcome" TEXT NOT NULL,
  "note" TEXT,
  "photo_urls" JSONB NOT NULL DEFAULT '[]',
  "reason" TEXT,
  "idempotency_key" TEXT,
  "actor_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "unit_component_reuse_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "unit_component_reuse_entries_kind_chk" CHECK ("kind" IN ('CREATED','CORRECTED','VOIDED')),
  CONSTRAINT "unit_component_reuse_entries_version_chk" CHECK ("version" >= 1 AND (("kind" = 'CREATED') = ("version" = 1))),
  CONSTRAINT "unit_component_reuse_entries_source_chk" CHECK ("source" = 'OWN_UNIT'),
  CONSTRAINT "unit_component_reuse_entries_outcome_chk" CHECK ("outcome" IN ('REUSED','RETURNED_TO_CUSTOMER','KEPT_WITH_UNIT','DISCARDED')),
  CONSTRAINT "unit_component_reuse_entries_qty_chk" CHECK ("qty" > 0),
  CONSTRAINT "unit_component_reuse_entries_name_chk" CHECK (length(btrim("name")) >= 2),
  CONSTRAINT "unit_component_reuse_entries_uom_chk" CHECK ("uom" ~ '^[A-Z0-9]{1,12}$'),
  CONSTRAINT "unit_component_reuse_entries_reason_chk" CHECK ("kind" = 'CREATED' OR ("reason" IS NOT NULL AND length(btrim("reason")) >= 3)),
  CONSTRAINT "unit_component_reuse_entries_photos_chk" CHECK (jsonb_typeof("photo_urls") = 'array')
);
CREATE UNIQUE INDEX "unit_component_reuse_entries_item_id_version_key" ON "unit_component_reuse_entries"("item_id", "version");
CREATE INDEX "unit_component_reuse_entries_unit_id_created_at_idx" ON "unit_component_reuse_entries"("unit_id", "created_at");
CREATE UNIQUE INDEX "unit_component_reuse_entries_unit_id_idempotency_key_key" ON "unit_component_reuse_entries"("unit_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL;
ALTER TABLE "unit_component_reuse_entries" ADD CONSTRAINT "unit_component_reuse_entries_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "unit_component_reuse_entries" ADD CONSTRAINT "unit_component_reuse_entries_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TRIGGER "unit_component_reuse_entries_append_only_trg" BEFORE UPDATE OR DELETE ON "unit_component_reuse_entries"
FOR EACH ROW EXECUTE FUNCTION production_adopsi_append_only();
