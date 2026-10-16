-- Uang Muka Supplier sebelum Barang Datang (Okt 2026) — ADITIF murni: 3 kolom NULL di fin_purchases + 1 tabel baru (kosong). Tanpa backfill, tanpa UPDATE/DELETE, tanpa mengubah kolom/tabel lama.
-- Jurnal DP memakai alur Pembelian LANGSUNG yang sudah ada (Dr 1-1500 Uang Muka / Cr Kas-Bank); penerapan ke faktur memakai sumber jurnal TERAPKAN_UANG_MUKA yang sudah ada.

-- AlterTable
ALTER TABLE "fin_purchases" ADD COLUMN "purchase_order_id" UUID,
ADD COLUMN "payment_reference" VARCHAR(120),
ADD COLUMN "advance_over_po_reason" TEXT;

-- CreateTable
CREATE TABLE "fin_supplier_bill_advance_applications" (
    "id" UUID NOT NULL,
    "advance_purchase_id" UUID NOT NULL,
    "bill_id" UUID NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "journal_id" UUID NOT NULL,
    "reversal_journal_id" UUID,
    "status" "FinAdvanceApplicationStatus" NOT NULL DEFAULT 'ACTIVE',
    "idempotency_key" TEXT NOT NULL,
    "note" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversed_by" TEXT,
    "reversed_at" TIMESTAMP(3),
    "reverse_reason" TEXT,

    CONSTRAINT "fin_supplier_bill_advance_applications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fin_purchases_purchase_order_id_idx" ON "fin_purchases"("purchase_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "fin_supplier_bill_advance_applications_journal_id_key" ON "fin_supplier_bill_advance_applications"("journal_id");

-- CreateIndex
CREATE UNIQUE INDEX "fin_supplier_bill_advance_applications_reversal_journal_id_key" ON "fin_supplier_bill_advance_applications"("reversal_journal_id");

-- CreateIndex
CREATE UNIQUE INDEX "fin_supplier_bill_advance_applications_idempotency_key_key" ON "fin_supplier_bill_advance_applications"("idempotency_key");

-- CreateIndex
CREATE INDEX "fin_supplier_bill_advance_applications_advance_purchase_id__idx" ON "fin_supplier_bill_advance_applications"("advance_purchase_id", "status");

-- CreateIndex
CREATE INDEX "fin_supplier_bill_advance_applications_bill_id_status_idx" ON "fin_supplier_bill_advance_applications"("bill_id", "status");

-- AddForeignKey
ALTER TABLE "fin_purchases" ADD CONSTRAINT "fin_purchases_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "fin_purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_supplier_bill_advance_applications" ADD CONSTRAINT "fin_supplier_bill_advance_applications_advance_purchase_id_fkey" FOREIGN KEY ("advance_purchase_id") REFERENCES "fin_purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_supplier_bill_advance_applications" ADD CONSTRAINT "fin_supplier_bill_advance_applications_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "fin_supplier_bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_supplier_bill_advance_applications" ADD CONSTRAINT "fin_supplier_bill_advance_applications_journal_id_fkey" FOREIGN KEY ("journal_id") REFERENCES "fin_journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_supplier_bill_advance_applications" ADD CONSTRAINT "fin_supplier_bill_advance_applications_reversal_journal_id_fkey" FOREIGN KEY ("reversal_journal_id") REFERENCES "fin_journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_supplier_bill_advance_applications" ADD CONSTRAINT "fin_supplier_bill_advance_applications_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_supplier_bill_advance_applications" ADD CONSTRAINT "fin_supplier_bill_advance_applications_reversed_by_fkey" FOREIGN KEY ("reversed_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Pengaman data: nominal penerapan harus positif; penerapan AKTIF tidak boleh punya jurnal balik, yang DIBALIK wajib punya (jurnal tidak boleh diedit — hanya dibalik).
ALTER TABLE "fin_supplier_bill_advance_applications" ADD CONSTRAINT "fin_sb_adv_app_amount_pos_chk" CHECK ("amount" > 0);
ALTER TABLE "fin_supplier_bill_advance_applications" ADD CONSTRAINT "fin_sb_adv_app_reversal_chk" CHECK (("status" = 'ACTIVE' AND "reversal_journal_id" IS NULL) OR ("status" = 'REVERSED' AND "reversal_journal_id" IS NOT NULL));
