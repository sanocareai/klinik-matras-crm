-- B3.6 Penutupan stok periodik & persediaan awal perpetual — ADITIF: enum value, 2 tabel baru, trigger immutable,
-- dan penggantian NAMA/DESKRIPSI akun 5-1100 & deskripsi 5-1150 (kode, tipe, dan histori jurnal tidak disentuh).
-- AlterEnum
ALTER TYPE "FinJournalSource" ADD VALUE 'PERSEDIAAN_AWAL';

-- CreateTable
CREATE TABLE "fin_inventory_openings" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "cutover_date" DATE NOT NULL,
    "counted_at" TIMESTAMP(3) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "created_by" TEXT,
    "finance_checked_by" TEXT,
    "finance_checked_at" TIMESTAMP(3),
    "warehouse_checked_by" TEXT,
    "warehouse_checked_at" TIMESTAMP(3),
    "content_hash" TEXT,
    "line_count" INTEGER,
    "total_value" DECIMAL(18,2),
    "posted_by" TEXT,
    "posted_at" TIMESTAMP(3),
    "post_reason" TEXT,
    "book_value_before" DECIMAL(18,2),
    "adjustment" DECIMAL(18,2),
    "journal_entry_id" UUID,
    "reversed_by" TEXT,
    "reversed_at" TIMESTAMP(3),
    "reverse_reason" TEXT,
    "reversal_entry_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fin_inventory_openings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_inventory_opening_lines" (
    "id" UUID NOT NULL,
    "opening_id" UUID NOT NULL,
    "material_id" UUID NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "unit" VARCHAR(20) NOT NULL,
    "unit_cost" DECIMAL(18,2) NOT NULL,
    "value" DECIMAL(18,2) NOT NULL,
    "price_source" VARCHAR(20) NOT NULL,
    "price_reference" TEXT,
    "price_note" TEXT,
    "notes" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_inventory_opening_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fin_inventory_openings_number_key" ON "fin_inventory_openings"("number");

-- CreateIndex
CREATE INDEX "fin_inventory_openings_cutover_date_status_idx" ON "fin_inventory_openings"("cutover_date", "status");

-- CreateIndex
CREATE UNIQUE INDEX "fin_inventory_opening_lines_opening_id_material_id_key" ON "fin_inventory_opening_lines"("opening_id", "material_id");

-- AddForeignKey
ALTER TABLE "fin_inventory_opening_lines" ADD CONSTRAINT "fin_inventory_opening_lines_opening_id_fkey" FOREIGN KEY ("opening_id") REFERENCES "fin_inventory_openings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_inventory_opening_lines" ADD CONSTRAINT "fin_inventory_opening_lines_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Satu snapshot persediaan awal AKTIF (DIPOSTING) per tanggal cutover — jaminan DB selain advisory lock di aplikasi.
CREATE UNIQUE INDEX "fin_inventory_openings_one_posted_per_cutover" ON "fin_inventory_openings"("cutover_date") WHERE "status" = 'DIPOSTING';
ALTER TABLE "fin_inventory_opening_lines" ADD CONSTRAINT "fin_inventory_opening_lines_qty_nonneg" CHECK ("qty" >= 0);
ALTER TABLE "fin_inventory_opening_lines" ADD CONSTRAINT "fin_inventory_opening_lines_cost_nonneg" CHECK ("unit_cost" >= 0);
ALTER TABLE "fin_inventory_openings" ADD CONSTRAINT "fin_inventory_openings_status_check" CHECK ("status" IN ('DRAFT','DIPERIKSA','DIPOSTING','DIBALIK','DIBATALKAN'));

-- Baris snapshot hanya boleh berubah selama induknya DRAFT.
CREATE OR REPLACE FUNCTION fin_inventory_opening_line_guard() RETURNS trigger AS $$
DECLARE st TEXT;
BEGIN
  SELECT status INTO st FROM fin_inventory_openings WHERE id = COALESCE(NEW.opening_id, OLD.opening_id);
  IF st IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'Snapshot persediaan berstatus % — isinya immutable dan tidak boleh diubah', st;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.opening_id <> OLD.opening_id THEN
    RAISE EXCEPTION 'Baris snapshot tidak boleh dipindah ke snapshot lain';
  END IF;
  RETURN COALESCE(NEW, OLD);
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER fin_inventory_opening_line_guard BEFORE INSERT OR UPDATE OR DELETE ON "fin_inventory_opening_lines"
  FOR EACH ROW EXECUTE FUNCTION fin_inventory_opening_line_guard();

-- Header: tidak boleh dihapus setelah diperiksa/diposting; isi inti terkunci di luar DRAFT; transisi status dibatasi.
CREATE OR REPLACE FUNCTION fin_inventory_opening_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN RAISE EXCEPTION 'Snapshot persediaan berstatus % tidak boleh dihapus', OLD.status; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status IN ('DIPOSTING','DIBALIK','DIBATALKAN') AND
     (NEW.cutover_date, NEW.counted_at, NEW.content_hash, NEW.line_count, NEW.total_value, NEW.finance_checked_by, NEW.finance_checked_at,
      NEW.warehouse_checked_by, NEW.warehouse_checked_at, NEW.number, NEW.created_by)
     IS DISTINCT FROM
     (OLD.cutover_date, OLD.counted_at, OLD.content_hash, OLD.line_count, OLD.total_value, OLD.finance_checked_by, OLD.finance_checked_at,
      OLD.warehouse_checked_by, OLD.warehouse_checked_at, OLD.number, OLD.created_by) THEN
    RAISE EXCEPTION 'Snapshot persediaan berstatus % bersifat immutable', OLD.status;
  END IF;
  IF OLD.status = 'DIPOSTING' AND
     (NEW.posted_by, NEW.posted_at, NEW.post_reason, NEW.book_value_before, NEW.adjustment, NEW.journal_entry_id)
     IS DISTINCT FROM (OLD.posted_by, OLD.posted_at, OLD.post_reason, OLD.book_value_before, OLD.adjustment, OLD.journal_entry_id) THEN
    RAISE EXCEPTION 'Data posting persediaan awal tidak boleh diubah — gunakan pembalikan resmi';
  END IF;
  IF OLD.status <> NEW.status AND NOT (
       (OLD.status = 'DRAFT' AND NEW.status IN ('DIPERIKSA','DIBATALKAN')) OR
       (OLD.status = 'DIPERIKSA' AND NEW.status IN ('DRAFT','DIPOSTING')) OR
       (OLD.status = 'DIPOSTING' AND NEW.status = 'DIBALIK')) THEN
    RAISE EXCEPTION 'Perubahan status snapshot persediaan % -> % tidak diizinkan', OLD.status, NEW.status;
  END IF;
  IF OLD.status IN ('DIBALIK','DIBATALKAN') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Snapshot persediaan berstatus % sudah final', OLD.status;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER fin_inventory_opening_guard BEFORE UPDATE OR DELETE ON "fin_inventory_openings"
  FOR EACH ROW EXECUTE FUNCTION fin_inventory_opening_guard();

-- Nama akun 5-1100 dibuat jelas (kode, tipe, saldo normal, dan histori tidak berubah).
UPDATE "fin_accounts" SET "name" = 'Beban Bahan Baku / Pemakaian Bahan',
  "description" = 'Periodik (sebelum tanggal cutover persediaan): pembelian bahan baku tanpa penerimaan Gudang. Perpetual (mulai cutover): pemakaian bahan dari Gudang (Dr 5-1100 / Cr 1-1400). Selisih persediaan akhir periodik dibukukan lewat jurnal Persediaan Awal.',
  "updated_at" = CURRENT_TIMESTAMP
WHERE "code" = '5-1100';
UPDATE "fin_accounts" SET
  "description" = 'Pembelian bahan baku yang dicatat manual lewat modul Pembelian SEBELUM Gudang dipakai. Sejak B3.5, tagihan supplier bahan baku periodik memakai 5-1100 (Beban Bahan Baku / Pemakaian Bahan), bukan akun ini.',
  "updated_at" = CURRENT_TIMESTAMP
WHERE "code" = '5-1150';
