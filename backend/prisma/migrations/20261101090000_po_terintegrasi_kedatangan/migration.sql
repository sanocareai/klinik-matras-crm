-- PO TERINTEGRASI FINANCE–GUDANG — ADITIF: catatan KEDATANGAN pada penerimaan yang sama, jumlah fisik PENDAMPING (PO + penerimaan), dan riwayat kedatangan append-only.
-- Tanpa UPDATE/DELETE/backfill: PO, penerimaan, stok, jurnal, tagihan yang sudah ada TIDAK berubah (kolom baru NULL; arrival_revision 0 = "belum dicatat"). Penerimaan lama tidak ditebak tanggal tibanya.

-- AlterTable: kedatangan pada penerimaan
ALTER TABLE "goods_receipts" ADD COLUMN "arrived_date" DATE,
ADD COLUMN "arrival_recorded_by" TEXT,
ADD COLUMN "arrival_recorded_at" TIMESTAMP(3),
ADD COLUMN "arrival_actor_roles" TEXT,
ADD COLUMN "arrival_workspace" VARCHAR(20),
ADD COLUMN "arrival_receiver" TEXT,
ADD COLUMN "arrival_note" TEXT,
ADD COLUMN "arrival_proof_urls" TEXT[],
ADD COLUMN "arrival_revision" INTEGER NOT NULL DEFAULT 0;

-- AlterTable: jumlah fisik pendamping aktual per baris penerimaan
ALTER TABLE "goods_receipt_lines" ADD COLUMN "companion_qty" DECIMAL(14,3);
ALTER TABLE "goods_receipt_lines" ADD COLUMN "replacement_for_line_id" UUID;

-- AlterTable: definisi pendamping per baris PO
ALTER TABLE "fin_purchase_order_lines" ADD COLUMN "companion_unit" VARCHAR(20),
ADD COLUMN "companion_mode" VARCHAR(10),
ADD COLUMN "companion_ratio" DECIMAL(18,6),
ADD COLUMN "companion_estimate" DECIMAL(14,3);

-- CreateTable
CREATE TABLE "goods_receipt_events" (
    "id" UUID NOT NULL,
    "goods_receipt_id" UUID NOT NULL,
    "type" VARCHAR(40) NOT NULL,
    "actor_id" TEXT,
    "actor_roles" TEXT,
    "workspace" VARCHAR(20),
    "reason" TEXT,
    "before" JSONB,
    "after" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goods_receipt_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "goods_receipt_events_goods_receipt_id_created_at_idx" ON "goods_receipt_events"("goods_receipt_id", "created_at");

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_arrival_recorded_by_fkey" FOREIGN KEY ("arrival_recorded_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_events" ADD CONSTRAINT "goods_receipt_events_goods_receipt_id_fkey" FOREIGN KEY ("goods_receipt_id") REFERENCES "goods_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_events" ADD CONSTRAINT "goods_receipt_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Konsistensi kedatangan: tanggal tiba dan waktu pencatatan selalu berpasangan; kedatangan yang tercatat WAJIB punya penerima (PIC), catatan, dan workspace; revisi 0 = belum dicatat.
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_kedatangan_chk" CHECK (
  (("arrived_date" IS NULL) = ("arrival_recorded_at" IS NULL))
  AND ("arrived_date" IS NULL OR (
    "arrival_receiver" IS NOT NULL AND length(btrim("arrival_receiver")) >= 2
    AND "arrival_note" IS NOT NULL AND length(btrim("arrival_note")) >= 1
    AND "arrival_workspace" IN ('FINANCE', 'GUDANG')
  ))
  AND ("arrival_revision" >= 0)
  AND (("arrived_date" IS NULL) = ("arrival_revision" = 0))
);

-- Jumlah pendamping tidak negatif.
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_companion_chk" CHECK ("companion_qty" IS NULL OR "companion_qty" >= 0);

-- Pengiriman pengganti barang yang ditolak: menunjuk baris penerimaan asal (tidak boleh menunjuk dirinya sendiri).
CREATE INDEX "goods_receipt_lines_replacement_for_line_id_idx" ON "goods_receipt_lines"("replacement_for_line_id");
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_replacement_for_line_id_fkey" FOREIGN KEY ("replacement_for_line_id") REFERENCES "goods_receipt_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_pengganti_chk" CHECK ("replacement_for_line_id" IS NULL OR "replacement_for_line_id" <> "id");

-- Pendamping PO: semua NULL, atau satuan + mode valid (TETAP wajib rasio > 0 tanpa estimasi tersimpan; AKTUAL tanpa rasio, estimasi opsional ≥ 0); tidak boleh digabung konversi satuan beli→stok.
ALTER TABLE "fin_purchase_order_lines" ADD CONSTRAINT "fin_purchase_order_lines_pendamping_chk" CHECK (
  ("companion_unit" IS NULL AND "companion_mode" IS NULL AND "companion_ratio" IS NULL AND "companion_estimate" IS NULL)
  OR (
    "companion_unit" IS NOT NULL AND length(btrim("companion_unit")) >= 1 AND "purchase_unit" IS NULL AND (
      ("companion_mode" = 'TETAP' AND "companion_ratio" IS NOT NULL AND "companion_ratio" > 0 AND "companion_estimate" IS NULL)
      OR ("companion_mode" = 'AKTUAL' AND "companion_ratio" IS NULL AND ("companion_estimate" IS NULL OR "companion_estimate" >= 0))
    )
  )
);

-- Riwayat kedatangan: jenis terbatas; koreksi WAJIB beralasan; APPEND-ONLY (UPDATE/DELETE ditolak database).
ALTER TABLE "goods_receipt_events" ADD CONSTRAINT "goods_receipt_events_jenis_chk" CHECK (
  "type" IN ('KEDATANGAN_DICATAT', 'KEDATANGAN_DIKOREKSI')
  AND ("type" <> 'KEDATANGAN_DIKOREKSI' OR ("reason" IS NOT NULL AND length(btrim("reason")) >= 5))
);

CREATE FUNCTION fn_goods_receipt_events_append_only() RETURNS trigger AS $fn$
BEGIN
  RAISE EXCEPTION 'Riwayat kedatangan penerimaan bersifat append-only: % tidak diizinkan', TG_OP USING ERRCODE = 'check_violation';
END;
$fn$ LANGUAGE plpgsql;

CREATE TRIGGER trg_goods_receipt_events_append_only BEFORE UPDATE OR DELETE ON "goods_receipt_events" FOR EACH ROW EXECUTE FUNCTION fn_goods_receipt_events_append_only();

-- Dasar termin faktur atas PO = TANGGAL_TIBA (tanggal barang tiba pada penerimaan) di samping TANGGAL_FAKTUR. Hanya MELEBARKAN daftar nilai yang diizinkan; faktur yang ada (semua NULL/TANGGAL_FAKTUR) tetap valid.
ALTER TABLE "fin_supplier_bills" DROP CONSTRAINT "fin_supplier_bills_term_chk";
ALTER TABLE "fin_supplier_bills" ADD CONSTRAINT "fin_supplier_bills_term_chk" CHECK (("term_type" IS NULL OR "term_type" IN ('TUNAI', 'HARI', 'TANGGAL_KHUSUS')) AND ("term_source" IS NULL OR "term_source" IN ('MASTER_SUPPLIER', 'PO', 'OVERRIDE_FAKTUR')) AND ("term_days" IS NULL OR "term_days" BETWEEN 0 AND 365) AND ("term_basis" IS NULL OR "term_basis" IN ('TANGGAL_FAKTUR', 'TANGGAL_TIBA')));
