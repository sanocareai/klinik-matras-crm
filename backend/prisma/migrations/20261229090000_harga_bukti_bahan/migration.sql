-- HARGA BUKTI BAHAN (Okt 2026). ADITIF: satu tabel baru + tiga kolom BARU pada fin_stock_movement_valuation_corrections (nullable/default). Tidak mengubah data yang ada, tidak menulis stok/catatan/jurnal.
-- fin_material_price_evidence : register harga per bahan + sumber bukti + satuan (faktor konversi) + periode berlaku + kepastian (TERBUKTI/TENTATIF) + alur DIAJUKAN→DISETUJUI (orang kedua).
--                               Baru berlaku untuk pergerakan lama setelah DISETUJUI, dan hanya lewat baris koreksi valuasi append-only (kolom evidence_id/tentative di tabel koreksi).
CREATE TABLE "fin_material_price_evidence" (
  "id" UUID NOT NULL,
  "material_id" UUID NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'DIAJUKAN',
  "price_input" DECIMAL(18,4) NOT NULL,
  "input_unit" VARCHAR(30) NOT NULL,
  "conversion_factor" DECIMAL(18,6) NOT NULL DEFAULT 1,
  "unit_cost" DECIMAL(24,8) NOT NULL,
  "source_kind" VARCHAR(24) NOT NULL,
  "source_ref" TEXT,
  "source_note" TEXT,
  "valid_from" DATE NOT NULL,
  "valid_to" DATE,
  "certainty" VARCHAR(10) NOT NULL DEFAULT 'TERBUKTI',
  "tentative_reason" TEXT,
  "goods_receipt_id" UUID,
  "replaces_id" UUID,
  "preview_hash" TEXT NOT NULL,
  "preview_count" INTEGER NOT NULL,
  "preview_value" DECIMAL(18,2) NOT NULL,
  "requested_by" TEXT,
  "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decided_by" TEXT,
  "decided_at" TIMESTAMP(3),
  "decision_note" TEXT,
  "applied_count" INTEGER,
  "idempotency_key" TEXT NOT NULL,
  CONSTRAINT "fin_material_price_evidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fin_material_price_evidence_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fin_material_price_evidence_status_chk" CHECK ("status" IN ('DIAJUKAN','DISETUJUI','DITOLAK','DIBATALKAN','DIGANTI')),
  CONSTRAINT "fin_material_price_evidence_certainty_chk" CHECK ("certainty" IN ('TERBUKTI','TENTATIF')),
  CONSTRAINT "fin_material_price_evidence_source_chk" CHECK ("source_kind" IN ('FAKTUR','NOTA_SUPPLIER','GR','PO','KESEPAKATAN','LAINNYA')),
  CONSTRAINT "fin_material_price_evidence_price_chk" CHECK ("price_input" > 0 AND "conversion_factor" > 0 AND "unit_cost" > 0),
  CONSTRAINT "fin_material_price_evidence_period_chk" CHECK ("valid_to" IS NULL OR "valid_to" >= "valid_from"),
  CONSTRAINT "fin_material_price_evidence_tentative_chk" CHECK ("certainty" = 'TERBUKTI' OR length(coalesce("tentative_reason", '')) >= 10)
);
CREATE UNIQUE INDEX "fin_material_price_evidence_idempotency_key_key" ON "fin_material_price_evidence"("idempotency_key");
CREATE INDEX "fin_material_price_evidence_material_id_status_idx" ON "fin_material_price_evidence"("material_id", "status");

ALTER TABLE "fin_stock_movement_valuation_corrections" ADD COLUMN "evidence_id" UUID;
ALTER TABLE "fin_stock_movement_valuation_corrections" ADD COLUMN "tentative" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "fin_stock_movement_valuation_corrections" ADD COLUMN "tentative_reason" TEXT;
ALTER TABLE "fin_stock_movement_valuation_corrections" ADD CONSTRAINT "fin_stock_movement_valuation_corrections_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "fin_material_price_evidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "fin_stock_movement_valuation_corrections_evidence_id_idx" ON "fin_stock_movement_valuation_corrections"("evidence_id");
