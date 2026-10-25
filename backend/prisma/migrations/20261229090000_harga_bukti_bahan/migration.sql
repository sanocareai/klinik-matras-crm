-- PENETAPAN NILAI RESMI BAHAN (Okt 2026). ADITIF: satu tabel baru + satu kolom BARU (nullable) pada fin_stock_movement_valuation_corrections. Tidak mengubah data yang ada, tidak menulis stok/catatan/jurnal.
-- fin_material_value_settlements : catatan PENERAPAN (bukan sumber harga). Harga TIDAK diketik di sini: server menurunkannya dari SATU sumber resmi — Persediaan Awal (lapisan saldo pembuka, status DIPERIKSA/DIPOSTING)
--                                  dan penerimaan (GR) berharga — per tanggal pemakaian. Tabel ini hanya mencatat: bahan, cakupan kelompok, hash pratinjau, pengaju/penyetuju (dua orang), dan hasil penerapan.
--                                  Nilai tiap pergerakan = baris koreksi valuasi append-only yang menautkan ke penetapan ini (settlement_id) dan membawa dasar (lapisan pembuka + GR) di kolom "after".
CREATE TABLE "fin_material_value_settlements" (
  "id" UUID NOT NULL,
  "material_id" UUID NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'DIAJUKAN',
  "scope" JSONB NOT NULL,
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
  CONSTRAINT "fin_material_value_settlements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fin_material_value_settlements_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fin_material_value_settlements_status_chk" CHECK ("status" IN ('DIAJUKAN','DISETUJUI','DITOLAK','DIBATALKAN'))
);
CREATE UNIQUE INDEX "fin_material_value_settlements_idempotency_key_key" ON "fin_material_value_settlements"("idempotency_key");
CREATE INDEX "fin_material_value_settlements_material_id_status_idx" ON "fin_material_value_settlements"("material_id", "status");
-- satu pengajuan aktif per bahan: mencegah dua penetapan menilai stok yang sama pada saat yang sama
CREATE UNIQUE INDEX "fin_material_value_settlements_satu_aktif" ON "fin_material_value_settlements"("material_id") WHERE "status" = 'DIAJUKAN';

ALTER TABLE "fin_stock_movement_valuation_corrections" ADD COLUMN "settlement_id" UUID;
ALTER TABLE "fin_stock_movement_valuation_corrections" ADD CONSTRAINT "fin_stock_movement_valuation_corrections_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "fin_material_value_settlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "fin_stock_movement_valuation_corrections_settlement_id_idx" ON "fin_stock_movement_valuation_corrections"("settlement_id");
