-- HARGA BERLAKU BAHAN = HPP OPERASIONAL (Okt 2026). ADITIF: tiga tabel baru + trigger append-only. Tidak mengubah data yang ada, tidak menulis stok/ISSUE/catatan/valuasi Finance/jurnal/GL.
-- BUKAN nilai buku dan BUKAN HPP final Finance: biaya perolehan Finance tetap fin_stock_movement_valuations (PSA/GR). Dua angka itu disimpan di tabel berbeda dan tidak pernah saling menimpa.
-- material_harga_berlaku          : riwayat harga operasional per SATUAN STOK dengan waktu mulai berlaku; append-only. Koreksi salah input = baris jenis KOREKSI yang menunjuk baris yang diganti (corrects_id) — baris lama tidak dihapus/diubah.
-- stock_movement_biaya_operasional: biaya operasional per pergerakan; DIBEKUKAN saat pemakaian diposting (harga yang berlaku pada WAKTU PEMAKAIAN); append-only; satu baris BEKU_SAAT_POSTING per pergerakan.
-- biaya_operasional_penerapan     : tindakan khusus memberi harga berlaku ke pemakaian LAMA (dua orang, hash pratinjau, satu pengajuan aktif per bahan); hasilnya baris baru PENERAPAN_DISETUJUI.
CREATE TABLE "material_harga_berlaku" (
  "id" UUID NOT NULL,
  "material_id" UUID NOT NULL,
  "jenis" VARCHAR(10) NOT NULL DEFAULT 'HARGA',
  "unit_price" DECIMAL(18,4) NOT NULL,
  "satuan" VARCHAR(20) NOT NULL,
  "effective_from" TIMESTAMP(3) NOT NULL,
  "previous_price" DECIMAL(18,4),
  "corrects_id" UUID,
  "reason" TEXT NOT NULL,
  "note" TEXT,
  "evidence_note" TEXT,
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "idempotency_key" TEXT NOT NULL,
  "impact" JSONB,
  CONSTRAINT "material_harga_berlaku_pkey" PRIMARY KEY ("id"),
  -- perubahan harga BIASA tidak boleh berlaku mundur (efektif >= waktu dicatat); hanya KOREKSI (tindakan khusus) boleh bertanggal lampau
  CONSTRAINT "material_harga_berlaku_tanpa_mundur_chk" CHECK ("jenis" = 'KOREKSI' OR "effective_from" >= "created_at"),
  CONSTRAINT "material_harga_berlaku_koreksi_dampak_chk" CHECK ("jenis" <> 'KOREKSI' OR "impact" IS NOT NULL),
  CONSTRAINT "material_harga_berlaku_jenis_chk" CHECK ("jenis" IN ('HARGA','KOREKSI')),
  CONSTRAINT "material_harga_berlaku_harga_chk" CHECK ("unit_price" > 0),
  CONSTRAINT "material_harga_berlaku_alasan_chk" CHECK (length(btrim("reason")) >= 5),
  CONSTRAINT "material_harga_berlaku_koreksi_chk" CHECK (("jenis" = 'KOREKSI') = ("corrects_id" IS NOT NULL))
);
CREATE UNIQUE INDEX "material_harga_berlaku_idempotency_key_key" ON "material_harga_berlaku"("idempotency_key");
-- satu baris hanya boleh dikoreksi SEKALI (rantai koreksi: koreksi dari koreksi memakai baris terbaru)
CREATE UNIQUE INDEX "material_harga_berlaku_corrects_id_key" ON "material_harga_berlaku"("corrects_id");
CREATE INDEX "material_harga_berlaku_material_id_effective_from_idx" ON "material_harga_berlaku"("material_id", "effective_from");

CREATE TABLE "biaya_operasional_penerapan" (
  "id" UUID NOT NULL,
  "material_id" UUID NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'DIAJUKAN',
  "scope" JSONB NOT NULL,
  "reason" TEXT NOT NULL,
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
  CONSTRAINT "biaya_operasional_penerapan_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "biaya_operasional_penerapan_status_chk" CHECK ("status" IN ('DIAJUKAN','DISETUJUI','DITOLAK','DIBATALKAN')),
  CONSTRAINT "biaya_operasional_penerapan_alasan_chk" CHECK (length(btrim("reason")) >= 5)
);
CREATE UNIQUE INDEX "biaya_operasional_penerapan_idempotency_key_key" ON "biaya_operasional_penerapan"("idempotency_key");
CREATE INDEX "biaya_operasional_penerapan_material_id_status_idx" ON "biaya_operasional_penerapan"("material_id", "status");
CREATE UNIQUE INDEX "biaya_operasional_penerapan_satu_aktif" ON "biaya_operasional_penerapan"("material_id") WHERE "status" = 'DIAJUKAN';

CREATE TABLE "stock_movement_biaya_operasional" (
  "id" UUID NOT NULL,
  "movement_id" UUID NOT NULL,
  "material_id" UUID NOT NULL,
  "unit_id" UUID NOT NULL,
  "status" VARCHAR(16) NOT NULL,
  "qty" DECIMAL(14,4) NOT NULL,
  "unit_cost" DECIMAL(18,4),
  "value" DECIMAL(18,2),
  "price_id" UUID,
  "price_effective_from" TIMESTAMP(3),
  "evidence_label" VARCHAR(30),
  "sumber" VARCHAR(24) NOT NULL,
  "basis_harga" VARCHAR(30) NOT NULL DEFAULT 'WAKTU_PEMAKAIAN',
  "basis_detail" JSONB,
  "application_id" UUID,
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stock_movement_biaya_operasional_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stock_movement_biaya_operasional_status_chk" CHECK ("status" IN ('DINILAI','TANPA_HARGA')),
  CONSTRAINT "stock_movement_biaya_operasional_basis_chk" CHECK ("basis_harga" IN ('WAKTU_PEMAKAIAN','WAKTU_WASTE','WAKTU_PENYESUAIAN','HARGA_ISSUE_ASAL','WAKTU_RETUR_TANPA_ISSUE')),
  CONSTRAINT "stock_movement_biaya_operasional_sumber_chk" CHECK ("sumber" IN ('BEKU_SAAT_POSTING','PENERAPAN_DISETUJUI')),
  CONSTRAINT "stock_movement_biaya_operasional_nilai_chk" CHECK (("status" = 'DINILAI') = ("unit_cost" IS NOT NULL AND "value" IS NOT NULL AND "price_id" IS NOT NULL))
);
CREATE INDEX "stock_movement_biaya_operasional_movement_id_created_at_idx" ON "stock_movement_biaya_operasional"("movement_id", "created_at");
CREATE INDEX "stock_movement_biaya_operasional_material_id_idx" ON "stock_movement_biaya_operasional"("material_id");
CREATE INDEX "stock_movement_biaya_operasional_application_id_idx" ON "stock_movement_biaya_operasional"("application_id");
CREATE UNIQUE INDEX "stock_movement_biaya_operasional_satu_beku" ON "stock_movement_biaya_operasional"("movement_id") WHERE "sumber" = 'BEKU_SAAT_POSTING';

-- FK (semua ON DELETE RESTRICT; tabel lama hanya DIRUJUK, tidak diubah)
ALTER TABLE "material_harga_berlaku" ADD CONSTRAINT "material_harga_berlaku_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "material_harga_berlaku" ADD CONSTRAINT "material_harga_berlaku_corrects_id_fkey" FOREIGN KEY ("corrects_id") REFERENCES "material_harga_berlaku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "biaya_operasional_penerapan" ADD CONSTRAINT "biaya_operasional_penerapan_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_movement_biaya_operasional" ADD CONSTRAINT "stock_movement_biaya_operasional_movement_id_fkey" FOREIGN KEY ("movement_id") REFERENCES "stock_movements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_movement_biaya_operasional" ADD CONSTRAINT "stock_movement_biaya_operasional_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_movement_biaya_operasional" ADD CONSTRAINT "stock_movement_biaya_operasional_price_id_fkey" FOREIGN KEY ("price_id") REFERENCES "material_harga_berlaku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_movement_biaya_operasional" ADD CONSTRAINT "stock_movement_biaya_operasional_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "biaya_operasional_penerapan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION harga_berlaku_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% append-only: tidak boleh diubah atau dihapus (koreksi = baris baru)', TG_TABLE_NAME;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER "material_harga_berlaku_append_only_trg" BEFORE UPDATE OR DELETE ON "material_harga_berlaku" FOR EACH ROW EXECUTE FUNCTION harga_berlaku_append_only();
CREATE TRIGGER "stock_movement_biaya_operasional_append_only_trg" BEFORE UPDATE OR DELETE ON "stock_movement_biaya_operasional" FOR EACH ROW EXECUTE FUNCTION harga_berlaku_append_only();
