-- USULAN BAHAN KATALOG & PEMAKAIAN SEMENTARA (Okt 2026, UX Bahan). ADITIF: hanya CREATE TABLE/INDEX/FUNCTION/TRIGGER baru. Tidak mengubah tabel yang ada.
-- material_proposals : usulan bahan dari Produksi. HANYA baris usulan — tidak membuat materials, saldo, penerimaan, stock_movements, biaya, atau jurnal. Keputusan (setujui/gabung/tolak) oleh Gudang.
-- unit_provisional_usages : fakta pemakaian bahan yang belum punya sumber stok resmi. BUKAN material_issues / stock_movements; tidak mengurangi saldo; tanpa biaya/jurnal.
--   Diselesaikan Gudang lewat jalur resmi yang SUDAH ada lalu ditautkan (stock_movement_id, unik: satu pergerakan hanya untuk satu catatan) atau dinyatakan bukan stok Gudang. Kolom asal tidak dapat diubah; tidak dapat dihapus.

CREATE TABLE "material_proposals" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "name_key" TEXT NOT NULL,
  "unit" TEXT NOT NULL,
  "kelompok" TEXT NOT NULL,
  "item_group" TEXT,
  "description" TEXT,
  "status" TEXT NOT NULL DEFAULT 'MENUNGGU_GUDANG',
  "requested_by" TEXT NOT NULL,
  "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "unit_id" UUID,
  "material_id" UUID,
  "decided_by" TEXT,
  "decided_at" TIMESTAMP(3),
  "decision_note" TEXT,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "material_proposals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "material_proposals_name_chk" CHECK (length(btrim("name")) >= 3 AND length(btrim("name_key")) >= 3),
  CONSTRAINT "material_proposals_status_chk" CHECK ("status" IN ('MENUNGGU_GUDANG','DISETUJUI','DIGABUNG','DITOLAK')),
  CONSTRAINT "material_proposals_kelompok_chk" CHECK ("kelompok" IN ('BUSA','KAIN','BENANG','PEGAS','KAYU','LEM_KIMIA','AKSESORI','LAINNYA')),
  CONSTRAINT "material_proposals_unit_chk" CHECK ("unit" ~ '^[A-Z0-9]{1,12}$'),
  CONSTRAINT "material_proposals_decision_chk" CHECK (
    ("status" = 'MENUNGGU_GUDANG' AND "decided_by" IS NULL AND "decided_at" IS NULL)
    OR ("status" <> 'MENUNGGU_GUDANG' AND "decided_by" IS NOT NULL AND "decided_at" IS NOT NULL)),
  CONSTRAINT "material_proposals_material_chk" CHECK ("status" NOT IN ('DISETUJUI','DIGABUNG') OR "material_id" IS NOT NULL),
  CONSTRAINT "material_proposals_reject_chk" CHECK ("status" <> 'DITOLAK' OR ("decision_note" IS NOT NULL AND length(btrim("decision_note")) >= 3))
);
CREATE UNIQUE INDEX "material_proposals_open_name_key" ON "material_proposals"("name_key") WHERE "status" = 'MENUNGGU_GUDANG';
CREATE INDEX "material_proposals_status_requested_at_idx" ON "material_proposals"("status", "requested_at");
ALTER TABLE "material_proposals" ADD CONSTRAINT "material_proposals_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "material_proposals" ADD CONSTRAINT "material_proposals_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "unit_provisional_usages" (
  "id" UUID NOT NULL,
  "unit_id" UUID NOT NULL,
  "proposal_id" UUID,
  "name" TEXT NOT NULL,
  "name_key" TEXT NOT NULL,
  "qty" DECIMAL(14,4) NOT NULL,
  "uom" TEXT NOT NULL,
  "origin_note" TEXT,
  "note" TEXT,
  "used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recorded_by" TEXT NOT NULL,
  "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" TEXT NOT NULL DEFAULT 'PERLU_REKONSILIASI',
  "resolution" TEXT,
  "material_id" UUID,
  "stock_movement_id" UUID,
  "resolved_by" TEXT,
  "resolved_at" TIMESTAMP(3),
  "resolution_note" TEXT,
  "cancelled_by" TEXT,
  "cancelled_at" TIMESTAMP(3),
  "cancel_reason" TEXT,
  "idempotency_key" TEXT,
  "corrected_from_id" UUID,
  CONSTRAINT "unit_provisional_usages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "unit_provisional_usages_name_chk" CHECK (length(btrim("name")) >= 3),
  CONSTRAINT "unit_provisional_usages_qty_chk" CHECK ("qty" > 0),
  CONSTRAINT "unit_provisional_usages_uom_chk" CHECK ("uom" ~ '^[A-Z0-9]{1,12}$'),
  CONSTRAINT "unit_provisional_usages_status_chk" CHECK ("status" IN ('PERLU_REKONSILIASI','DIREKONSILIASI','DIBATALKAN')),
  CONSTRAINT "unit_provisional_usages_resolution_chk" CHECK ("resolution" IS NULL OR "resolution" IN ('TAUTKAN_ISSUE','TANPA_STOK')),
  -- DIREKONSILIASI wajib lengkap; PERLU_REKONSILIASI tanpa penyelesaian; DIBATALKAN boleh membawa penyelesaian 'bukan stok Gudang' yang dibatalkan sebagai salah input.
  CONSTRAINT "unit_provisional_usages_resolved_chk" CHECK (
    ("status" = 'DIREKONSILIASI' AND "resolution" IS NOT NULL AND "resolved_by" IS NOT NULL AND "resolved_at" IS NOT NULL)
    OR ("status" = 'PERLU_REKONSILIASI' AND "resolution" IS NULL AND "resolved_by" IS NULL AND "resolved_at" IS NULL)
    OR ("status" = 'DIBATALKAN' AND ("resolution" IS NULL OR "resolution" = 'TANPA_STOK'))),
  CONSTRAINT "unit_provisional_usages_link_chk" CHECK (
    "resolution" IS DISTINCT FROM 'TAUTKAN_ISSUE' OR ("stock_movement_id" IS NOT NULL AND "material_id" IS NOT NULL)),
  CONSTRAINT "unit_provisional_usages_nostock_chk" CHECK (
    "resolution" IS DISTINCT FROM 'TANPA_STOK' OR ("stock_movement_id" IS NULL AND "resolution_note" IS NOT NULL AND length(btrim("resolution_note")) >= 10)),
  CONSTRAINT "unit_provisional_usages_cancel_chk" CHECK (
    ("status" = 'DIBATALKAN') = ("cancelled_by" IS NOT NULL AND "cancelled_at" IS NOT NULL AND "cancel_reason" IS NOT NULL AND length(btrim("cancel_reason")) >= 3)),
  CONSTRAINT "unit_provisional_usages_corrected_chk" CHECK ("corrected_from_id" IS NULL OR "corrected_from_id" <> "id")
);
CREATE UNIQUE INDEX "unit_provisional_usages_stock_movement_id_key" ON "unit_provisional_usages"("stock_movement_id");
CREATE UNIQUE INDEX "unit_provisional_usages_unit_id_idempotency_key_key" ON "unit_provisional_usages"("unit_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL;
CREATE UNIQUE INDEX "unit_provisional_usages_corrected_from_id_key" ON "unit_provisional_usages"("corrected_from_id");
CREATE INDEX "unit_provisional_usages_unit_id_recorded_at_idx" ON "unit_provisional_usages"("unit_id", "recorded_at");
CREATE INDEX "unit_provisional_usages_status_recorded_at_idx" ON "unit_provisional_usages"("status", "recorded_at");
ALTER TABLE "unit_provisional_usages" ADD CONSTRAINT "unit_provisional_usages_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "unit_provisional_usages" ADD CONSTRAINT "unit_provisional_usages_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "material_proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "unit_provisional_usages" ADD CONSTRAINT "unit_provisional_usages_corrected_from_id_fkey" FOREIGN KEY ("corrected_from_id") REFERENCES "unit_provisional_usages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "unit_provisional_usages" ADD CONSTRAINT "unit_provisional_usages_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "unit_provisional_usages" ADD CONSTRAINT "unit_provisional_usages_stock_movement_id_fkey" FOREIGN KEY ("stock_movement_id") REFERENCES "stock_movements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Penjaga: tidak boleh dihapus; kolom asal tidak boleh berubah; sesudah diputuskan/diselesaikan/dibatalkan baris final.
CREATE OR REPLACE FUNCTION material_proposals_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'material_proposals tidak boleh dihapus (riwayat usulan)'; END IF;
  IF OLD.status <> 'MENUNGGU_GUDANG' THEN RAISE EXCEPTION 'usulan bahan sudah diputuskan (%): baris final', OLD.status; END IF;
  IF NEW.id <> OLD.id OR NEW.name <> OLD.name OR NEW.name_key <> OLD.name_key OR NEW.unit <> OLD.unit OR NEW.requested_by <> OLD.requested_by OR NEW.requested_at <> OLD.requested_at
     OR NEW.unit_id IS DISTINCT FROM OLD.unit_id THEN RAISE EXCEPTION 'kolom asal usulan bahan tidak boleh diubah'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER "material_proposals_guard_trg" BEFORE UPDATE OR DELETE ON "material_proposals" FOR EACH ROW EXECUTE FUNCTION material_proposals_guard();

CREATE OR REPLACE FUNCTION unit_provisional_usages_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'unit_provisional_usages tidak boleh dihapus (riwayat asal catatan)'; END IF;
  IF OLD.status = 'DIBATALKAN' OR (OLD.status = 'DIREKONSILIASI' AND NOT (OLD.resolution = 'TANPA_STOK' AND NEW.status = 'DIBATALKAN')) THEN RAISE EXCEPTION 'catatan pemakaian sementara sudah % : baris final', OLD.status; END IF;
  IF OLD.status = 'DIREKONSILIASI' AND (NEW.resolution IS DISTINCT FROM OLD.resolution OR NEW.resolved_by IS DISTINCT FROM OLD.resolved_by OR NEW.resolved_at IS DISTINCT FROM OLD.resolved_at OR NEW.resolution_note IS DISTINCT FROM OLD.resolution_note OR NEW.stock_movement_id IS DISTINCT FROM OLD.stock_movement_id OR NEW.material_id IS DISTINCT FROM OLD.material_id) THEN RAISE EXCEPTION 'riwayat penyelesaian tidak boleh berubah saat dibatalkan'; END IF;
  IF NEW.id <> OLD.id OR NEW.unit_id <> OLD.unit_id OR NEW.proposal_id IS DISTINCT FROM OLD.proposal_id OR NEW.name <> OLD.name OR NEW.name_key <> OLD.name_key OR NEW.qty <> OLD.qty OR NEW.uom <> OLD.uom
     OR NEW.origin_note IS DISTINCT FROM OLD.origin_note OR NEW.note IS DISTINCT FROM OLD.note OR NEW.used_at <> OLD.used_at OR NEW.recorded_by <> OLD.recorded_by OR NEW.recorded_at <> OLD.recorded_at
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR NEW.corrected_from_id IS DISTINCT FROM OLD.corrected_from_id THEN RAISE EXCEPTION 'kolom asal catatan pemakaian sementara tidak boleh diubah'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER "unit_provisional_usages_guard_trg" BEFORE UPDATE OR DELETE ON "unit_provisional_usages" FOR EACH ROW EXECUTE FUNCTION unit_provisional_usages_guard();
