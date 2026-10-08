-- CreateTable
CREATE TABLE "fin_stock_movement_valuations" (
    "id" UUID NOT NULL,
    "movement_id" UUID NOT NULL,
    "material_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "movement_type" VARCHAR(20) NOT NULL,
    "cost_kind" VARCHAR(20) NOT NULL,
    "qty" DECIMAL(14,4) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "unit_cost_basis" DECIMAL(24,8),
    "value" DECIMAL(18,2),
    "basis_method" VARCHAR(30) NOT NULL DEFAULT 'RATA_RATA_TERTIMBANG',
    "basis" JSONB,
    "valued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_stock_movement_valuations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fin_stock_movement_valuations_movement_id_key" ON "fin_stock_movement_valuations"("movement_id");

-- CreateIndex
CREATE INDEX "fin_stock_movement_valuations_unit_id_valued_at_idx" ON "fin_stock_movement_valuations"("unit_id", "valued_at");

-- CreateIndex
CREATE INDEX "fin_stock_movement_valuations_material_id_idx" ON "fin_stock_movement_valuations"("material_id");

-- AddForeignKey
ALTER TABLE "fin_stock_movement_valuations" ADD CONSTRAINT "fin_stock_movement_valuations_movement_id_fkey" FOREIGN KEY ("movement_id") REFERENCES "stock_movements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Pengaman data: DINILAI wajib punya harga & nilai; TANPA_HARGA wajib NULL (bukan nol).
ALTER TABLE "fin_stock_movement_valuations" ADD CONSTRAINT "fin_stock_movement_valuations_status_chk" CHECK (
  (status = 'DINILAI' AND unit_cost_basis IS NOT NULL AND value IS NOT NULL) OR (status = 'TANPA_HARGA' AND unit_cost_basis IS NULL AND value IS NULL)
);

-- Append-only: nilai yang sudah dibekukan tidak boleh diubah atau dihapus.
CREATE OR REPLACE FUNCTION fin_stock_movement_valuation_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'fin_stock_movement_valuations append-only: % ditolak', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER fin_stock_movement_valuation_immutable_trg BEFORE UPDATE OR DELETE ON "fin_stock_movement_valuations" FOR EACH ROW EXECUTE FUNCTION fin_stock_movement_valuation_immutable();
