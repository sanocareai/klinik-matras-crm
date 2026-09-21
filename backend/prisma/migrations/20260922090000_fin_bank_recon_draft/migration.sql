-- Rekonsiliasi Bank: periode SEMENTARA tanpa rekening koran (aditif; tidak menyentuh jurnal, saldo, atau periode yang ada).
-- Nilai enum baru TIDAK dipakai di migrasi ini (ADD VALUE harus di-commit dulu).
ALTER TYPE "FinReconStatus" ADD VALUE IF NOT EXISTS 'DRAF_MENUNGGU_MUTASI';

ALTER TABLE "fin_bank_statements" ADD COLUMN "cutoff_start_at" TIMESTAMP(3);
ALTER TABLE "fin_bank_statements" ADD COLUMN "cutoff_end_at" TIMESTAMP(3);
ALTER TABLE "fin_bank_statements" ADD COLUMN "source_key" TEXT;
CREATE UNIQUE INDEX "fin_bank_statements_source_key_key" ON "fin_bank_statements"("source_key");
