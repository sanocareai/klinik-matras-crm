-- KOREKSI SALDO PER BAHAN dari Stok & Lokasi (Okt 2026). ADITIF: satu tabel baru + trigger append-only. Tidak mengubah tabel yang ada, tidak menulis stok/jurnal/valuasi/harga.
-- Tabel ini hanya menyimpan KONTEKS pengajuan koreksi saldo: jumlah fisik yang dinyatakan benar, saldo ledger yang DILIHAT pengaju, keadaan saldo saat itu, dan kunci anti klik ganda.
-- Perubahan saldo tetap lewat jalur resmi Penyesuaian Stok (stock_adjustment_requests -> persetujuan ORANG LAIN -> posting oleh postStockMovement). Satu baris per permintaan penyesuaian (adjustment_request_id unik).
CREATE TABLE "koreksi_saldo_bahan" (
  "id" UUID NOT NULL,
  "adjustment_request_id" UUID NOT NULL,
  "material_id" UUID NOT NULL,
  "satuan" VARCHAR(20) NOT NULL,
  "jumlah_fisik" DECIMAL(14,4) NOT NULL,
  "saldo_dilihat" DECIMAL(14,4) NOT NULL,
  "selisih" DECIMAL(14,4) NOT NULL,
  "keadaan_awal" VARCHAR(24) NOT NULL,
  "jumlah_pergerakan_awal" INTEGER NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "koreksi_saldo_bahan_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "koreksi_saldo_bahan_fisik_chk" CHECK ("jumlah_fisik" >= 0),
  CONSTRAINT "koreksi_saldo_bahan_selisih_chk" CHECK ("selisih" <> 0 AND "selisih" = "jumlah_fisik" - "saldo_dilihat"),
  CONSTRAINT "koreksi_saldo_bahan_keadaan_chk" CHECK ("keadaan_awal" IN ('BELUM_ADA_CATATAN','NOL_MENURUT_PERGERAKAN','NOL_TERVERIFIKASI','POSITIF','MINUS')),
  CONSTRAINT "koreksi_saldo_bahan_catatan_chk" CHECK (("keadaan_awal" = 'BELUM_ADA_CATATAN') = ("jumlah_pergerakan_awal" = 0))
);
CREATE UNIQUE INDEX "koreksi_saldo_bahan_adjustment_request_id_key" ON "koreksi_saldo_bahan"("adjustment_request_id");
CREATE UNIQUE INDEX "koreksi_saldo_bahan_idempotency_key_key" ON "koreksi_saldo_bahan"("idempotency_key");
CREATE INDEX "koreksi_saldo_bahan_material_id_created_at_idx" ON "koreksi_saldo_bahan"("material_id", "created_at");

ALTER TABLE "koreksi_saldo_bahan" ADD CONSTRAINT "koreksi_saldo_bahan_adjustment_request_id_fkey" FOREIGN KEY ("adjustment_request_id") REFERENCES "stock_adjustment_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "koreksi_saldo_bahan" ADD CONSTRAINT "koreksi_saldo_bahan_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION koreksi_saldo_bahan_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% append-only: konteks pengajuan koreksi saldo tidak boleh diubah atau dihapus', TG_TABLE_NAME;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER "koreksi_saldo_bahan_append_only_trg" BEFORE UPDATE OR DELETE ON "koreksi_saldo_bahan" FOR EACH ROW EXECUTE FUNCTION koreksi_saldo_bahan_append_only();
