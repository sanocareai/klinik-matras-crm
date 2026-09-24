-- B3 Rekonsiliasi Cutoff & Late-Posting Guard — ADITIF (tabel baru + trigger). Tidak mengubah data/kolom lama.
CREATE TABLE "fin_recon_snapshots" (
    "id" UUID NOT NULL,
    "statement_id" UUID NOT NULL,
    "cash_account_id" UUID NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "opening_bank" DECIMAL(18,2) NOT NULL,
    "closing_bank" DECIMAL(18,2) NOT NULL,
    "book_balance" DECIMAL(18,2) NOT NULL,
    "cutoff_start_at" TIMESTAMP(3),
    "cutoff_end_at" TIMESTAMP(3),
    "confirmed_at" TIMESTAMP(3),
    "confirmed_source" TEXT NOT NULL,
    "snapshot_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hwm_at" TIMESTAMP(3) NOT NULL,
    "hwm_entry_id" UUID,
    "hwm_entry_number" TEXT,
    "entry_count" INTEGER NOT NULL,
    "entry_hash" TEXT NOT NULL,
    "summary" JSONB NOT NULL,
    "explanation" TEXT,
    "created_by" TEXT,
    "invalidated_at" TIMESTAMP(3),
    "invalidated_by" TEXT,
    "invalid_reason" TEXT,
    CONSTRAINT "fin_recon_snapshots_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "fin_recon_snapshots_statement_id_key" ON "fin_recon_snapshots"("statement_id");
CREATE INDEX "fin_recon_snapshots_cash_account_id_period_end_idx" ON "fin_recon_snapshots"("cash_account_id", "period_end");
ALTER TABLE "fin_recon_snapshots" ADD CONSTRAINT "fin_recon_snapshots_statement_id_fkey" FOREIGN KEY ("statement_id") REFERENCES "fin_bank_statements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "fin_recon_exception_reviews" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "ref_id" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fin_recon_exception_reviews_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "fin_recon_exception_reviews_code_ref_id_key" ON "fin_recon_exception_reviews"("code", "ref_id");

-- Snapshot immutable: kolom inti tidak boleh berubah, baris tidak boleh dihapus. Invalidasi hanya sekali (NULL -> terisi).
CREATE OR REPLACE FUNCTION fin_recon_snapshot_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Snapshot rekonsiliasi bersifat immutable dan tidak boleh dihapus';
  END IF;
  IF (NEW.statement_id, NEW.cash_account_id, NEW.period_start, NEW.period_end, NEW.opening_bank, NEW.closing_bank, NEW.book_balance,
      NEW.cutoff_start_at, NEW.cutoff_end_at, NEW.confirmed_at, NEW.confirmed_source, NEW.snapshot_at, NEW.hwm_at, NEW.hwm_entry_id,
      NEW.hwm_entry_number, NEW.entry_count, NEW.entry_hash, NEW.summary, NEW.explanation, NEW.created_by)
     IS DISTINCT FROM
     (OLD.statement_id, OLD.cash_account_id, OLD.period_start, OLD.period_end, OLD.opening_bank, OLD.closing_bank, OLD.book_balance,
      OLD.cutoff_start_at, OLD.cutoff_end_at, OLD.confirmed_at, OLD.confirmed_source, OLD.snapshot_at, OLD.hwm_at, OLD.hwm_entry_id,
      OLD.hwm_entry_number, OLD.entry_count, OLD.entry_hash, OLD.summary, OLD.explanation, OLD.created_by) THEN
    RAISE EXCEPTION 'Snapshot rekonsiliasi bersifat immutable: kolom inti tidak boleh diubah';
  END IF;
  IF OLD.invalidated_at IS NOT NULL AND (NEW.invalidated_at, NEW.invalidated_by, NEW.invalid_reason) IS DISTINCT FROM (OLD.invalidated_at, OLD.invalidated_by, OLD.invalid_reason) THEN
    RAISE EXCEPTION 'Snapshot yang sudah tidak berlaku tidak bisa diubah lagi';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER fin_recon_snapshot_immutable_trg
  BEFORE UPDATE OR DELETE ON "fin_recon_snapshots"
  FOR EACH ROW EXECUTE FUNCTION fin_recon_snapshot_immutable();
