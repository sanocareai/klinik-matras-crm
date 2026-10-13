-- Nota Kredit / Keringanan Order (Okt 2026) — ADITIF murni: 1 nilai enum + 1 tabel baru (kosong). Tanpa backfill, tanpa UPDATE/DELETE, tanpa mengubah kolom/tabel lama.

-- AlterEnum
ALTER TYPE "FinJournalSource" ADD VALUE 'NOTA_KREDIT_ORDER';

-- CreateTable
CREATE TABLE "fin_order_credits" (
    "id" UUID NOT NULL,
    "credit_number" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "kind" VARCHAR(30) NOT NULL DEFAULT 'POTONGAN_HARGA',
    "credit_date" DATE NOT NULL,
    "refund_id" UUID,
    "journal_id" UUID,
    "reversal_journal_id" UUID,
    "status" VARCHAR(20) NOT NULL DEFAULT 'AKTIF',
    "idempotency_key" TEXT NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_by" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,

    CONSTRAINT "fin_order_credits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fin_order_credits_credit_number_key" ON "fin_order_credits"("credit_number");

-- CreateIndex
CREATE UNIQUE INDEX "fin_order_credits_journal_id_key" ON "fin_order_credits"("journal_id");

-- CreateIndex
CREATE UNIQUE INDEX "fin_order_credits_reversal_journal_id_key" ON "fin_order_credits"("reversal_journal_id");

-- CreateIndex
CREATE UNIQUE INDEX "fin_order_credits_idempotency_key_key" ON "fin_order_credits"("idempotency_key");

-- CreateIndex
CREATE INDEX "fin_order_credits_order_id_status_idx" ON "fin_order_credits"("order_id", "status");

-- CreateIndex
CREATE INDEX "fin_order_credits_refund_id_idx" ON "fin_order_credits"("refund_id");

-- Satu refund hanya boleh punya SATU nota kredit AKTIF (indeks parsial; tidak dimodelkan di Prisma — pola sama dengan indeks parsial lain di repo).
-- Pengaman terakhir di level DB di atas pengecekan aplikasi: dua permintaan paralel tidak bisa sama-sama menautkan refund yang sama.
CREATE UNIQUE INDEX "fin_order_credits_refund_aktif_uniq" ON "fin_order_credits"("refund_id") WHERE "refund_id" IS NOT NULL AND "status" = 'AKTIF';

-- AddForeignKey
ALTER TABLE "fin_order_credits" ADD CONSTRAINT "fin_order_credits_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_order_credits" ADD CONSTRAINT "fin_order_credits_refund_id_fkey" FOREIGN KEY ("refund_id") REFERENCES "fin_refunds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_order_credits" ADD CONSTRAINT "fin_order_credits_journal_id_fkey" FOREIGN KEY ("journal_id") REFERENCES "fin_journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_order_credits" ADD CONSTRAINT "fin_order_credits_reversal_journal_id_fkey" FOREIGN KEY ("reversal_journal_id") REFERENCES "fin_journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_order_credits" ADD CONSTRAINT "fin_order_credits_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_order_credits" ADD CONSTRAINT "fin_order_credits_cancelled_by_fkey" FOREIGN KEY ("cancelled_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Pengaman data: nominal positif; status hanya AKTIF/DIBATALKAN; yang DIBATALKAN wajib punya alasan; nota mandiri (tanpa refund) wajib punya jurnal.
ALTER TABLE "fin_order_credits" ADD CONSTRAINT "fin_order_credits_amount_pos_chk" CHECK ("amount" > 0);
ALTER TABLE "fin_order_credits" ADD CONSTRAINT "fin_order_credits_status_chk" CHECK ("status" IN ('AKTIF', 'DIBATALKAN'));
ALTER TABLE "fin_order_credits" ADD CONSTRAINT "fin_order_credits_batal_chk" CHECK ("status" = 'AKTIF' OR ("cancelled_at" IS NOT NULL AND "cancel_reason" IS NOT NULL));
ALTER TABLE "fin_order_credits" ADD CONSTRAINT "fin_order_credits_jurnal_chk" CHECK ("refund_id" IS NOT NULL OR "journal_id" IS NOT NULL);
