-- CreateEnum
CREATE TYPE "FinBankImportStatus" AS ENUM ('AKTIF', 'DIBATALKAN');

-- CreateEnum
CREATE TYPE "FinBankMatchKind" AS ENUM ('OTOMATIS', 'MANUAL', 'KECUALI');

-- CreateTable
CREATE TABLE "fin_bank_import_batches" (
    "id" UUID NOT NULL,
    "cash_account_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_sha256" TEXT NOT NULL,
    "row_count" INTEGER NOT NULL,
    "total_debit" DECIMAL(18,2) NOT NULL,
    "total_credit" DECIMAL(18,2) NOT NULL,
    "date_from" DATE NOT NULL,
    "date_to" DATE NOT NULL,
    "mapping" JSONB NOT NULL,
    "status" "FinBankImportStatus" NOT NULL DEFAULT 'AKTIF',
    "imported_by" TEXT,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rolled_back_at" TIMESTAMP(3),
    "rolled_back_by" TEXT,
    "rolled_back_reason" TEXT,

    CONSTRAINT "fin_bank_import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_bank_import_lines" (
    "id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "cash_account_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "tx_date" DATE NOT NULL,
    "effective_date" DATE,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "debit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "running_balance" DECIMAL(18,2),
    "fingerprint" TEXT NOT NULL,
    "raw" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rolled_back_at" TIMESTAMP(3),

    CONSTRAINT "fin_bank_import_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_bank_match_groups" (
    "id" UUID NOT NULL,
    "cash_account_id" UUID NOT NULL,
    "kind" "FinBankMatchKind" NOT NULL,
    "category" TEXT,
    "reason" TEXT,
    "shape" TEXT NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undone_at" TIMESTAMP(3),
    "undone_by" TEXT,
    "undone_reason" TEXT,

    CONSTRAINT "fin_bank_match_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_bank_match_items" (
    "id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "bank_line_id" UUID,
    "journal_line_id" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "fin_bank_match_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_bank_recon_periods" (
    "id" UUID NOT NULL,
    "cash_account_id" UUID NOT NULL,
    "period_from" DATE NOT NULL,
    "period_to" DATE NOT NULL,
    "balance_source" TEXT NOT NULL,
    "actual_balance" DECIMAL(18,2) NOT NULL,
    "book_balance" DECIMAL(18,2) NOT NULL,
    "residual" DECIMAL(18,2) NOT NULL,
    "hwm_at" TIMESTAMP(3) NOT NULL,
    "snapshot_hash" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "completed_by" TEXT,
    "completed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invalidated_at" TIMESTAMP(3),
    "invalidated_by" TEXT,
    "invalid_reason" TEXT,

    CONSTRAINT "fin_bank_recon_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_cash_counts" (
    "id" UUID NOT NULL,
    "cash_account_id" UUID NOT NULL,
    "count_date" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "note" TEXT,
    "counted_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_cash_counts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fin_bank_import_batches_cash_account_id_imported_at_idx" ON "fin_bank_import_batches"("cash_account_id", "imported_at");

-- CreateIndex
CREATE INDEX "fin_bank_import_lines_cash_account_id_tx_date_idx" ON "fin_bank_import_lines"("cash_account_id", "tx_date");

-- CreateIndex
CREATE INDEX "fin_bank_import_lines_batch_id_idx" ON "fin_bank_import_lines"("batch_id");

-- CreateIndex
CREATE INDEX "fin_bank_match_groups_cash_account_id_created_at_idx" ON "fin_bank_match_groups"("cash_account_id", "created_at");

-- CreateIndex
CREATE INDEX "fin_bank_match_items_group_id_idx" ON "fin_bank_match_items"("group_id");

-- CreateIndex
CREATE INDEX "fin_bank_recon_periods_cash_account_id_period_to_idx" ON "fin_bank_recon_periods"("cash_account_id", "period_to");

-- CreateIndex
CREATE INDEX "fin_cash_counts_cash_account_id_count_date_idx" ON "fin_cash_counts"("cash_account_id", "count_date");

-- AddForeignKey
ALTER TABLE "fin_bank_import_batches" ADD CONSTRAINT "fin_bank_import_batches_cash_account_id_fkey" FOREIGN KEY ("cash_account_id") REFERENCES "fin_cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_bank_import_batches" ADD CONSTRAINT "fin_bank_import_batches_imported_by_fkey" FOREIGN KEY ("imported_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_bank_import_batches" ADD CONSTRAINT "fin_bank_import_batches_rolled_back_by_fkey" FOREIGN KEY ("rolled_back_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_bank_import_lines" ADD CONSTRAINT "fin_bank_import_lines_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "fin_bank_import_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_bank_import_lines" ADD CONSTRAINT "fin_bank_import_lines_cash_account_id_fkey" FOREIGN KEY ("cash_account_id") REFERENCES "fin_cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_bank_match_groups" ADD CONSTRAINT "fin_bank_match_groups_cash_account_id_fkey" FOREIGN KEY ("cash_account_id") REFERENCES "fin_cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_bank_match_groups" ADD CONSTRAINT "fin_bank_match_groups_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_bank_match_groups" ADD CONSTRAINT "fin_bank_match_groups_undone_by_fkey" FOREIGN KEY ("undone_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_bank_match_items" ADD CONSTRAINT "fin_bank_match_items_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "fin_bank_match_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_bank_match_items" ADD CONSTRAINT "fin_bank_match_items_bank_line_id_fkey" FOREIGN KEY ("bank_line_id") REFERENCES "fin_bank_import_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_bank_match_items" ADD CONSTRAINT "fin_bank_match_items_journal_line_id_fkey" FOREIGN KEY ("journal_line_id") REFERENCES "fin_journal_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_bank_recon_periods" ADD CONSTRAINT "fin_bank_recon_periods_cash_account_id_fkey" FOREIGN KEY ("cash_account_id") REFERENCES "fin_cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_bank_recon_periods" ADD CONSTRAINT "fin_bank_recon_periods_completed_by_fkey" FOREIGN KEY ("completed_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_bank_recon_periods" ADD CONSTRAINT "fin_bank_recon_periods_invalidated_by_fkey" FOREIGN KEY ("invalidated_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_cash_counts" ADD CONSTRAINT "fin_cash_counts_cash_account_id_fkey" FOREIGN KEY ("cash_account_id") REFERENCES "fin_cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_cash_counts" ADD CONSTRAINT "fin_cash_counts_counted_by_fkey" FOREIGN KEY ("counted_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ── Integritas (dikunci di database, bukan hanya aplikasi) ──────────────────────────────────────────────────────────────
-- Satu berkas rekening koran aktif hanya boleh masuk SEKALI; satu baris bank aktif hanya sekali per rekening; satu baris bank / baris jurnal hanya di SATU kelompok pencocokan aktif.
CREATE UNIQUE INDEX "fin_bank_import_batches_file_aktif_uniq" ON "fin_bank_import_batches"("cash_account_id", "file_sha256") WHERE "status" = 'AKTIF';
CREATE UNIQUE INDEX "fin_bank_import_lines_fp_aktif_uniq" ON "fin_bank_import_lines"("cash_account_id", "fingerprint") WHERE "rolled_back_at" IS NULL;
CREATE UNIQUE INDEX "fin_bank_match_items_bank_aktif_uniq" ON "fin_bank_match_items"("bank_line_id") WHERE "active" AND "bank_line_id" IS NOT NULL;
CREATE UNIQUE INDEX "fin_bank_match_items_jurnal_aktif_uniq" ON "fin_bank_match_items"("journal_line_id") WHERE "active" AND "journal_line_id" IS NOT NULL;
CREATE UNIQUE INDEX "fin_bank_recon_periods_aktif_uniq" ON "fin_bank_recon_periods"("cash_account_id", "period_to") WHERE "invalidated_at" IS NULL;

ALTER TABLE "fin_bank_import_lines" ADD CONSTRAINT "fin_bank_import_lines_nominal_chk" CHECK ("debit" >= 0 AND "credit" >= 0 AND ("debit" = 0 OR "credit" = 0));
ALTER TABLE "fin_bank_match_items" ADD CONSTRAINT "fin_bank_match_items_satu_sisi_chk" CHECK (("bank_line_id" IS NULL) <> ("journal_line_id" IS NULL));
ALTER TABLE "fin_cash_counts" ADD CONSTRAINT "fin_cash_counts_nominal_chk" CHECK ("amount" >= 0);

-- Baris bank: tidak pernah dihapus; satu-satunya perubahan yang sah adalah mengisi rolled_back_at SEKALI (saat batch dibatalkan).
CREATE OR REPLACE FUNCTION fin_bank_import_line_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Baris rekening koran bersifat immutable dan tidak boleh dihapus';
  END IF;
  IF (NEW.id, NEW.batch_id, NEW.cash_account_id, NEW.line_no, NEW.tx_date, NEW.effective_date, NEW.description, NEW.reference, NEW.debit, NEW.credit,
      NEW.running_balance, NEW.fingerprint, NEW.raw, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.batch_id, OLD.cash_account_id, OLD.line_no, OLD.tx_date, OLD.effective_date, OLD.description, OLD.reference, OLD.debit, OLD.credit,
      OLD.running_balance, OLD.fingerprint, OLD.raw, OLD.created_at) THEN
    RAISE EXCEPTION 'Baris rekening koran bersifat immutable: isi tidak boleh diubah';
  END IF;
  IF OLD.rolled_back_at IS NOT NULL AND NEW.rolled_back_at IS DISTINCT FROM OLD.rolled_back_at THEN
    RAISE EXCEPTION 'Baris rekening koran yang sudah dibatalkan tidak boleh diubah lagi';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER fin_bank_import_line_immutable_trg BEFORE UPDATE OR DELETE ON "fin_bank_import_lines" FOR EACH ROW EXECUTE FUNCTION fin_bank_import_line_immutable();

-- Batch impor: isi tetap; hanya status AKTIF -> DIBATALKAN (sekali) beserta jejak pembatalannya.
CREATE OR REPLACE FUNCTION fin_bank_import_batch_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Batch impor rekening koran tidak boleh dihapus';
  END IF;
  IF (NEW.id, NEW.cash_account_id, NEW.file_name, NEW.file_sha256, NEW.row_count, NEW.total_debit, NEW.total_credit, NEW.date_from, NEW.date_to, NEW.mapping, NEW.imported_at)
     IS DISTINCT FROM
     (OLD.id, OLD.cash_account_id, OLD.file_name, OLD.file_sha256, OLD.row_count, OLD.total_debit, OLD.total_credit, OLD.date_from, OLD.date_to, OLD.mapping, OLD.imported_at) THEN
    RAISE EXCEPTION 'Batch impor rekening koran immutable: isi tidak boleh diubah';
  END IF;
  IF NEW.imported_by IS DISTINCT FROM OLD.imported_by AND NEW.imported_by IS NOT NULL THEN
    RAISE EXCEPTION 'Batch impor rekening koran immutable: pengimpor tidak boleh diubah';
  END IF;
  IF OLD.status = 'DIBATALKAN' AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.rolled_back_at IS DISTINCT FROM OLD.rolled_back_at OR NEW.rolled_back_reason IS DISTINCT FROM OLD.rolled_back_reason) THEN
    RAISE EXCEPTION 'Batch impor yang sudah dibatalkan tidak boleh diubah lagi';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER fin_bank_import_batch_immutable_trg BEFORE UPDATE OR DELETE ON "fin_bank_import_batches" FOR EACH ROW EXECUTE FUNCTION fin_bank_import_batch_immutable();

-- Kelompok pencocokan: tidak dihapus; hanya bisa DIBATALKAN (undone_*) sekali.
CREATE OR REPLACE FUNCTION fin_bank_match_group_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Kelompok pencocokan bank tidak boleh dihapus (batalkan saja; riwayat tetap)';
  END IF;
  IF (NEW.id, NEW.cash_account_id, NEW.kind, NEW.category, NEW.reason, NEW.shape, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.cash_account_id, OLD.kind, OLD.category, OLD.reason, OLD.shape, OLD.created_at) THEN
    RAISE EXCEPTION 'Kelompok pencocokan bank immutable: isi tidak boleh diubah';
  END IF;
  IF OLD.undone_at IS NOT NULL AND (NEW.undone_at IS DISTINCT FROM OLD.undone_at OR NEW.undone_reason IS DISTINCT FROM OLD.undone_reason) THEN
    RAISE EXCEPTION 'Kelompok pencocokan yang sudah dibatalkan tidak boleh diubah lagi';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER fin_bank_match_group_immutable_trg BEFORE UPDATE OR DELETE ON "fin_bank_match_groups" FOR EACH ROW EXECUTE FUNCTION fin_bank_match_group_immutable();

-- Item pencocokan: dibuat sekali; hanya active true -> false. Saat dibuat, rekening baris bank dan baris jurnal HARUS sama dengan rekening kelompoknya.
CREATE OR REPLACE FUNCTION fin_bank_match_item_guard() RETURNS trigger AS $$
DECLARE
  rek uuid;
  rek_baris uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Item pencocokan bank tidak boleh dihapus (batalkan kelompoknya; riwayat tetap)';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.id, NEW.group_id, NEW.bank_line_id, NEW.journal_line_id) IS DISTINCT FROM (OLD.id, OLD.group_id, OLD.bank_line_id, OLD.journal_line_id) THEN
      RAISE EXCEPTION 'Item pencocokan bank immutable: isi tidak boleh diubah';
    END IF;
    IF OLD.active = false AND NEW.active = true THEN
      RAISE EXCEPTION 'Item pencocokan yang sudah dibatalkan tidak boleh diaktifkan lagi';
    END IF;
    RETURN NEW;
  END IF;
  SELECT cash_account_id INTO rek FROM fin_bank_match_groups WHERE id = NEW.group_id;
  IF NEW.bank_line_id IS NOT NULL THEN
    SELECT cash_account_id INTO rek_baris FROM fin_bank_import_lines WHERE id = NEW.bank_line_id;
  ELSE
    SELECT cash_account_id INTO rek_baris FROM fin_journal_lines WHERE id = NEW.journal_line_id;
  END IF;
  IF rek_baris IS DISTINCT FROM rek THEN
    RAISE EXCEPTION 'Pencocokan hanya boleh antara baris bank dan baris jurnal pada REKENING YANG SAMA';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER fin_bank_match_item_guard_trg BEFORE INSERT OR UPDATE OR DELETE ON "fin_bank_match_items" FOR EACH ROW EXECUTE FUNCTION fin_bank_match_item_guard();

-- Periode rekonsiliasi selesai: isi (snapshot) tidak boleh diubah; hanya boleh dinyatakan tidak berlaku (invalidated_*) sekali.
CREATE OR REPLACE FUNCTION fin_bank_recon_period_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Periode rekonsiliasi bank tidak boleh dihapus';
  END IF;
  IF (NEW.id, NEW.cash_account_id, NEW.period_from, NEW.period_to, NEW.balance_source, NEW.actual_balance, NEW.book_balance, NEW.residual, NEW.hwm_at,
      NEW.snapshot_hash, NEW.snapshot, NEW.completed_at)
     IS DISTINCT FROM
     (OLD.id, OLD.cash_account_id, OLD.period_from, OLD.period_to, OLD.balance_source, OLD.actual_balance, OLD.book_balance, OLD.residual, OLD.hwm_at,
      OLD.snapshot_hash, OLD.snapshot, OLD.completed_at) THEN
    RAISE EXCEPTION 'Periode rekonsiliasi bank immutable: isi tidak boleh diubah';
  END IF;
  IF OLD.invalidated_at IS NOT NULL AND (NEW.invalidated_at IS DISTINCT FROM OLD.invalidated_at OR NEW.invalid_reason IS DISTINCT FROM OLD.invalid_reason) THEN
    RAISE EXCEPTION 'Periode rekonsiliasi yang sudah dinyatakan tidak berlaku tidak boleh diubah lagi';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER fin_bank_recon_period_immutable_trg BEFORE UPDATE OR DELETE ON "fin_bank_recon_periods" FOR EACH ROW EXECUTE FUNCTION fin_bank_recon_period_immutable();

-- Hitung fisik kas: catatan sejarah, tidak diubah/dihapus.
CREATE OR REPLACE FUNCTION fin_cash_count_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.counted_by IS NULL AND OLD.counted_by IS NOT NULL
     AND (NEW.id, NEW.cash_account_id, NEW.count_date, NEW.amount, NEW.note, NEW.created_at) IS NOT DISTINCT FROM (OLD.id, OLD.cash_account_id, OLD.count_date, OLD.amount, OLD.note, OLD.created_at) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Hitung fisik kas bersifat immutable: tidak boleh diubah atau dihapus';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER fin_cash_count_immutable_trg BEFORE UPDATE OR DELETE ON "fin_cash_counts" FOR EACH ROW EXECUTE FUNCTION fin_cash_count_immutable();
