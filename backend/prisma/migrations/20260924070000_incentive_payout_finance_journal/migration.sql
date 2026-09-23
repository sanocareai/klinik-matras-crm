-- Integrasi IncentivePayout dengan ledger Finance (24 September 2026).
-- Aditif murni: nilai enum baru, 3 kolom nullable + FK + unique, dan akun
-- COA "6-1180 Beban Insentif Driver" (idempoten; tidak menimpa akun ada).

-- AlterEnum
ALTER TYPE "FinJournalSource" ADD VALUE 'INSENTIF_DRIVER';

-- AlterTable
ALTER TABLE "incentive_payouts"
  ADD COLUMN "cash_account_id" UUID,
  ADD COLUMN "journal_entry_id" UUID,
  ADD COLUMN "void_journal_entry_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "incentive_payouts_journal_entry_id_key" ON "incentive_payouts"("journal_entry_id");
CREATE UNIQUE INDEX "incentive_payouts_void_journal_entry_id_key" ON "incentive_payouts"("void_journal_entry_id");
CREATE INDEX "incentive_payouts_cash_account_id_idx" ON "incentive_payouts"("cash_account_id");

-- AddForeignKey
ALTER TABLE "incentive_payouts" ADD CONSTRAINT "incentive_payouts_cash_account_id_fkey" FOREIGN KEY ("cash_account_id") REFERENCES "fin_cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "incentive_payouts" ADD CONSTRAINT "incentive_payouts_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "fin_journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "incentive_payouts" ADD CONSTRAINT "incentive_payouts_void_journal_entry_id_fkey" FOREIGN KEY ("void_journal_entry_id") REFERENCES "fin_journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Akun beban (hanya kalau kode & systemKey belum dipakai)
INSERT INTO "fin_accounts" ("id","code","name","type","normal_balance","parent_id","is_postable","cash_flow_category","system_key","active","description","created_at","updated_at")
SELECT gen_random_uuid(), '6-1180', 'Beban Insentif Driver', 'BEBAN', 'DEBIT',
       (SELECT "id" FROM "fin_accounts" WHERE "code" = '6-0000'), true, 'OPERASI', 'BEBAN_INSENTIF_DRIVER', true,
       'Insentif per-alamat driver & helper delivery yang sudah dibayar (Pembayaran Insentif). Diposting otomatis dari IncentivePayout.',
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "fin_accounts" WHERE "code" = '6-1180' OR "system_key" = 'BEBAN_INSENTIF_DRIVER')
  AND EXISTS (SELECT 1 FROM "fin_accounts" WHERE "code" = '6-0000');
