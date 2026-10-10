-- RETUR SUPPLIER & DEBIT NOTE — ADITIF: 6 tabel baru + 1 kolom pada fin_supplier_bills (DEFAULT 0) + 3 nilai enum + 1 fungsi/trigger pengaman penerimaan.
-- Tanpa UPDATE/DELETE/backfill: faktur, penerimaan, stok, jurnal, pembayaran yang sudah ada TIDAK berubah.

-- Nilai enum baru (hanya dipakai kode setelah migrasi ini commit)
ALTER TYPE "StockMovementType" ADD VALUE 'SUPPLIER_RETURN';
ALTER TYPE "FinJournalSource" ADD VALUE 'RETUR_SUPPLIER';
ALTER TYPE "FinJournalSource" ADD VALUE 'DEBIT_NOTE_SUPPLIER';

-- Kolom kredit pada faktur: bagian faktur yang sudah dikurangi debit note / saldo kredit. amount faktur tidak pernah diubah.
ALTER TABLE "fin_supplier_bills" ADD COLUMN "credit_applied" DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE "fin_supplier_bills" ADD CONSTRAINT "fin_supplier_bills_credit_applied_chk" CHECK ("credit_applied" >= 0 AND "credit_applied" <= "amount");

-- Retur Supplier (header)
CREATE TABLE "supplier_returns" (
    "id" UUID NOT NULL,
    "return_number" TEXT NOT NULL,
    "supplier_id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "decision" VARCHAR(20) NOT NULL DEFAULT 'KREDIT',
    "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "reason_code" VARCHAR(30) NOT NULL,
    "reason" TEXT NOT NULL,
    "evidence_urls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "note" TEXT,
    "return_date" DATE,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "dispatched_by" TEXT,
    "dispatched_at" TIMESTAMP(3),
    "dispatch_pic" TEXT,
    "dispatch_note" TEXT,
    "dispatch_proof_urls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cancelled_by" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,

    CONSTRAINT "supplier_returns_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "supplier_return_lines" (
    "id" UUID NOT NULL,
    "return_id" UUID NOT NULL,
    "goods_receipt_line_id" UUID NOT NULL,
    "purchase_order_line_id" UUID NOT NULL,
    "material_id" UUID NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "condition" TEXT,
    "note" TEXT,
    "qty_unbilled" DECIMAL(14,3),
    "qty_billed" DECIMAL(14,3),
    "unit_cost" DECIMAL(24,8),
    "stock_value" DECIMAL(18,2),
    "stock_value_billed" DECIMAL(18,2),
    "stock_movement_id" UUID,
    "reversal_movement_id" UUID,

    CONSTRAINT "supplier_return_lines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "fin_supplier_debit_notes" (
    "id" UUID NOT NULL,
    "debit_number" TEXT NOT NULL,
    "supplier_id" UUID NOT NULL,
    "return_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'MENUNGGU',
    "amount" DECIMAL(18,2) NOT NULL,
    "stock_value" DECIMAL(18,2) NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "approval_note" TEXT,
    "cancelled_by" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,

    CONSTRAINT "fin_supplier_debit_notes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "fin_supplier_debit_note_lines" (
    "id" UUID NOT NULL,
    "debit_note_id" UUID NOT NULL,
    "return_line_id" UUID NOT NULL,
    "bill_id" UUID NOT NULL,
    "goods_receipt_line_id" UUID NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "invoice_unit_price" DECIMAL(18,2) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "stock_value" DECIMAL(18,2) NOT NULL,
    "applied_to_bill" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "credit_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "fin_supplier_debit_note_lines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "fin_supplier_credits" (
    "id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "debit_note_id" UUID NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "used_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" VARCHAR(20) NOT NULL DEFAULT 'AKTIF',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "cancelled_at" TIMESTAMP(3),

    CONSTRAINT "fin_supplier_credits_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "fin_supplier_credit_applications" (
    "id" UUID NOT NULL,
    "credit_id" UUID NOT NULL,
    "bill_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'AKTIF',
    "note" TEXT,
    "applied_by" TEXT,
    "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_by" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,

    CONSTRAINT "fin_supplier_credit_applications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "supplier_returns_return_number_key" ON "supplier_returns"("return_number");
CREATE INDEX "supplier_returns_supplier_id_status_idx" ON "supplier_returns"("supplier_id", "status");
CREATE INDEX "supplier_returns_purchase_order_id_idx" ON "supplier_returns"("purchase_order_id");
CREATE INDEX "supplier_returns_status_idx" ON "supplier_returns"("status");
CREATE INDEX "supplier_return_lines_return_id_idx" ON "supplier_return_lines"("return_id");
CREATE INDEX "supplier_return_lines_goods_receipt_line_id_idx" ON "supplier_return_lines"("goods_receipt_line_id");
CREATE INDEX "supplier_return_lines_purchase_order_line_id_idx" ON "supplier_return_lines"("purchase_order_line_id");
CREATE UNIQUE INDEX "fin_supplier_debit_notes_debit_number_key" ON "fin_supplier_debit_notes"("debit_number");
CREATE INDEX "fin_supplier_debit_notes_supplier_id_status_idx" ON "fin_supplier_debit_notes"("supplier_id", "status");
CREATE INDEX "fin_supplier_debit_notes_return_id_idx" ON "fin_supplier_debit_notes"("return_id");
CREATE INDEX "fin_supplier_debit_note_lines_debit_note_id_idx" ON "fin_supplier_debit_note_lines"("debit_note_id");
CREATE INDEX "fin_supplier_debit_note_lines_bill_id_idx" ON "fin_supplier_debit_note_lines"("bill_id");
CREATE INDEX "fin_supplier_debit_note_lines_goods_receipt_line_id_idx" ON "fin_supplier_debit_note_lines"("goods_receipt_line_id");
CREATE UNIQUE INDEX "fin_supplier_credits_debit_note_id_key" ON "fin_supplier_credits"("debit_note_id");
CREATE INDEX "fin_supplier_credits_supplier_id_status_idx" ON "fin_supplier_credits"("supplier_id", "status");
CREATE INDEX "fin_supplier_credit_applications_credit_id_idx" ON "fin_supplier_credit_applications"("credit_id");
CREATE INDEX "fin_supplier_credit_applications_bill_id_idx" ON "fin_supplier_credit_applications"("bill_id");

-- AddForeignKey
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "fin_suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "fin_purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_return_lines" ADD CONSTRAINT "supplier_return_lines_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "supplier_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "supplier_return_lines" ADD CONSTRAINT "supplier_return_lines_goods_receipt_line_id_fkey" FOREIGN KEY ("goods_receipt_line_id") REFERENCES "goods_receipt_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_return_lines" ADD CONSTRAINT "supplier_return_lines_purchase_order_line_id_fkey" FOREIGN KEY ("purchase_order_line_id") REFERENCES "fin_purchase_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_return_lines" ADD CONSTRAINT "supplier_return_lines_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fin_supplier_debit_notes" ADD CONSTRAINT "fin_supplier_debit_notes_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "fin_suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fin_supplier_debit_notes" ADD CONSTRAINT "fin_supplier_debit_notes_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "supplier_returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fin_supplier_debit_note_lines" ADD CONSTRAINT "fin_supplier_debit_note_lines_debit_note_id_fkey" FOREIGN KEY ("debit_note_id") REFERENCES "fin_supplier_debit_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fin_supplier_debit_note_lines" ADD CONSTRAINT "fin_supplier_debit_note_lines_return_line_id_fkey" FOREIGN KEY ("return_line_id") REFERENCES "supplier_return_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fin_supplier_debit_note_lines" ADD CONSTRAINT "fin_supplier_debit_note_lines_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "fin_supplier_bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fin_supplier_credits" ADD CONSTRAINT "fin_supplier_credits_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "fin_suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fin_supplier_credits" ADD CONSTRAINT "fin_supplier_credits_debit_note_id_fkey" FOREIGN KEY ("debit_note_id") REFERENCES "fin_supplier_debit_notes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fin_supplier_credit_applications" ADD CONSTRAINT "fin_supplier_credit_applications_credit_id_fkey" FOREIGN KEY ("credit_id") REFERENCES "fin_supplier_credits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fin_supplier_credit_applications" ADD CONSTRAINT "fin_supplier_credit_applications_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "fin_supplier_bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Konsistensi dokumen
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_status_chk" CHECK (
  "decision" = 'KREDIT'
  AND "status" IN ('DRAFT', 'KELUAR', 'SELESAI', 'DIBATALKAN')
  AND length(btrim("reason")) >= 5
  AND ("status" NOT IN ('KELUAR', 'SELESAI') OR ("dispatched_at" IS NOT NULL AND "return_date" IS NOT NULL AND "dispatch_pic" IS NOT NULL AND length(btrim("dispatch_pic")) >= 2))
  AND ("status" <> 'DIBATALKAN' OR ("cancel_reason" IS NOT NULL AND length(btrim("cancel_reason")) >= 5))
);
ALTER TABLE "supplier_return_lines" ADD CONSTRAINT "supplier_return_lines_qty_chk" CHECK (
  "qty" > 0
  AND (("qty_unbilled" IS NULL) = ("qty_billed" IS NULL))
  AND ("qty_unbilled" IS NULL OR ("qty_unbilled" >= 0 AND "qty_billed" >= 0 AND "qty_unbilled" + "qty_billed" = "qty"))
);
ALTER TABLE "fin_supplier_debit_notes" ADD CONSTRAINT "fin_supplier_debit_notes_chk" CHECK (
  "status" IN ('MENUNGGU', 'DISETUJUI', 'DIBATALKAN') AND "amount" > 0 AND "stock_value" >= 0
  AND ("status" <> 'DISETUJUI' OR ("approved_at" IS NOT NULL AND "approved_by" IS NOT NULL))
  AND ("status" <> 'DIBATALKAN' OR ("cancel_reason" IS NOT NULL AND length(btrim("cancel_reason")) >= 5))
);
CREATE UNIQUE INDEX "fin_supplier_debit_notes_return_aktif_key" ON "fin_supplier_debit_notes"("return_id") WHERE "status" <> 'DIBATALKAN';
ALTER TABLE "fin_supplier_debit_note_lines" ADD CONSTRAINT "fin_supplier_debit_note_lines_chk" CHECK (
  "qty" > 0 AND "amount" > 0 AND "stock_value" >= 0 AND "applied_to_bill" >= 0 AND "credit_amount" >= 0 AND "applied_to_bill" + "credit_amount" <= "amount"
);
ALTER TABLE "fin_supplier_credits" ADD CONSTRAINT "fin_supplier_credits_chk" CHECK (
  "status" IN ('AKTIF', 'DIBATALKAN') AND "amount" > 0 AND "used_amount" >= 0 AND "used_amount" <= "amount"
);
ALTER TABLE "fin_supplier_credit_applications" ADD CONSTRAINT "fin_supplier_credit_applications_chk" CHECK (
  "status" IN ('AKTIF', 'DIBATALKAN') AND "amount" > 0
  AND ("status" <> 'DIBATALKAN' OR ("cancel_reason" IS NOT NULL AND length(btrim("cancel_reason")) >= 5))
);

-- BATAS DENGAN "KOREKSI PENERIMAAN": baris penerimaan yang sudah punya retur aktif (KELUAR/SELESAI) tidak boleh diubah jumlahnya / ditautkan ulang.
-- Koreksi apa pun pada baris itu harus membatalkan returnya dulu (alur resmi), supaya stok, GRNI, dan debit note tidak menyimpang dari penerimaan.
CREATE FUNCTION fn_goods_receipt_line_terkunci_retur() RETURNS trigger AS $fn$
BEGIN
  IF EXISTS (
    SELECT 1 FROM supplier_return_lines rl JOIN supplier_returns r ON r.id = rl.return_id
    WHERE rl.goods_receipt_line_id = OLD.id AND r.status IN ('KELUAR', 'SELESAI')
  ) THEN
    RAISE EXCEPTION 'Baris penerimaan ini sudah punya Retur Supplier aktif — batalkan returnya dulu sebelum mengoreksi jumlah penerimaan' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

CREATE TRIGGER trg_goods_receipt_line_terkunci_retur BEFORE UPDATE OF "received_qty", "accepted_qty", "rejected_qty", "purchase_order_line_id", "material_id", "goods_receipt_id" ON "goods_receipt_lines" FOR EACH ROW EXECUTE FUNCTION fn_goods_receipt_line_terkunci_retur();
