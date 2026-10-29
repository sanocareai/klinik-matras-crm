-- PERNYATAAN "TANPA BAHAN BARU" per unit (Okt 2026). ADITIF: satu tabel baru. Tidak mengubah tabel yang ada; tidak menulis stok/Material Issue/Run/QC/biaya/jurnal/harga.
-- Dipakai penyaring kelengkapan Order Produksi: unit tanpa catatan pemakaian TIDAK ditebak "tidak butuh bahan" — pernyataan eksplisit (alasan wajib, pelaku, waktu) menggantikannya. Pencabutan tercatat, baris tidak dihapus.
CREATE TABLE "unit_material_declarations" (
  "id" UUID NOT NULL,
  "unit_id" UUID NOT NULL,
  "kind" VARCHAR(24) NOT NULL DEFAULT 'TANPA_BAHAN_BARU',
  "reason" TEXT NOT NULL,
  "declared_by" TEXT NOT NULL,
  "declared_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',
  "revoked_by" TEXT,
  "revoked_at" TIMESTAMP(3),
  "revoke_reason" TEXT,
  "idempotency_key" TEXT NOT NULL,
  CONSTRAINT "unit_material_declarations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "unit_material_declarations_kind_chk" CHECK ("kind" IN ('TANPA_BAHAN_BARU')),
  CONSTRAINT "unit_material_declarations_status_chk" CHECK ("status" IN ('ACTIVE','REVOKED')),
  CONSTRAINT "unit_material_declarations_reason_chk" CHECK (char_length(btrim("reason")) >= 5),
  CONSTRAINT "unit_material_declarations_revoke_chk" CHECK (("status" = 'REVOKED') = ("revoked_at" IS NOT NULL AND "revoked_by" IS NOT NULL AND char_length(btrim(coalesce("revoke_reason", ''))) >= 5))
);
CREATE UNIQUE INDEX "unit_material_declarations_idempotency_key_key" ON "unit_material_declarations"("idempotency_key");
CREATE INDEX "unit_material_declarations_unit_id_status_idx" ON "unit_material_declarations"("unit_id", "status");
-- satu pernyataan AKTIF per unit
CREATE UNIQUE INDEX "unit_material_declarations_unit_aktif_uq" ON "unit_material_declarations"("unit_id") WHERE "status" = 'ACTIVE';
ALTER TABLE "unit_material_declarations" ADD CONSTRAINT "unit_material_declarations_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
