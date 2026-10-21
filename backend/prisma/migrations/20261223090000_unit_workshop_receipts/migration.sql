-- PENERIMAAN WORKSHOP OLEH PETUGAS (Okt 2026): catatan resmi "unit diterima di workshop" tanpa mengaktifkan Produksi V2. ADITIF: hanya CREATE TABLE/INDEX/TRIGGER baru.
-- Satu penerimaan AKTIF per unit: UNIQUE(unit_id, seq) + kunci baris unit = klik ganda/serentak menjadi satu catatan; seq naik hanya bila penerimaan sebelumnya dikoreksi "belum diterima fisik". Append-only; koreksi = baris terpisah di unit_workshop_receipt_corrections (nilai lama + baru, pelaku, alasan). TIDAK menulis production_runs_v2 / fase / tahap / QC / stok / jurnal / custody.
-- Dibaca sebagai bukti ke-4 milestone "Diterima di Workshop" (lib/domain/workshopMilestone.js, basis WORKSHOP_RECEIPT).

CREATE TABLE "unit_workshop_receipts" (
  "id" UUID NOT NULL,
  "unit_id" UUID NOT NULL,
  "seq" INTEGER NOT NULL DEFAULT 1,
  "location_id" UUID NOT NULL,
  "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "received_by_id" TEXT NOT NULL,
  "note" TEXT,
  "prev_storage_location" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "unit_workshop_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "unit_workshop_receipts_seq_chk" CHECK ("seq" >= 1)
);
CREATE UNIQUE INDEX "unit_workshop_receipts_unit_id_seq_key" ON "unit_workshop_receipts"("unit_id", "seq");
CREATE INDEX "unit_workshop_receipts_received_at_idx" ON "unit_workshop_receipts"("received_at");
ALTER TABLE "unit_workshop_receipts" ADD CONSTRAINT "unit_workshop_receipts_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "unit_workshop_receipts" ADD CONSTRAINT "unit_workshop_receipts_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "storage_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Append-only (jejak audit): fungsi yang sama dengan tabel adopsi Admin (dibuat migrasi 20261221090000).
CREATE TRIGGER "unit_workshop_receipts_append_only_trg" BEFORE UPDATE OR DELETE ON "unit_workshop_receipts"
FOR EACH ROW EXECUTE FUNCTION production_adopsi_append_only();

-- KOREKSI penerimaan (append-only; catatan asli TIDAK diubah/dihapus). kind: LOCATION = lokasi salah (unit memang diterima); NOT_RECEIVED = unit ternyata belum diterima fisik.
-- old_value / new_value menyimpan nilai lama dan baru (lokasi: {locationId, code}; NOT_RECEIVED: baru = null). impact = dampak yang ditampilkan saat koreksi.
CREATE TABLE "unit_workshop_receipt_corrections" (
  "id" UUID NOT NULL,
  "receipt_id" UUID NOT NULL,
  "unit_id" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "old_value" JSONB NOT NULL,
  "new_value" JSONB,
  "reason" TEXT NOT NULL,
  "impact" JSONB,
  "idempotency_key" TEXT,
  "actor_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "unit_workshop_receipt_corrections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "unit_workshop_receipt_corrections_kind_chk" CHECK ("kind" IN ('LOCATION','NOT_RECEIVED')),
  CONSTRAINT "unit_workshop_receipt_corrections_reason_chk" CHECK (length(btrim("reason")) >= 3),
  CONSTRAINT "unit_workshop_receipt_corrections_new_chk" CHECK (("kind" = 'LOCATION' AND "new_value" IS NOT NULL) OR ("kind" = 'NOT_RECEIVED' AND "new_value" IS NULL))
);
CREATE INDEX "unit_workshop_receipt_corrections_receipt_id_created_at_idx" ON "unit_workshop_receipt_corrections"("receipt_id", "created_at");
CREATE INDEX "unit_workshop_receipt_corrections_unit_id_idx" ON "unit_workshop_receipt_corrections"("unit_id");
-- Penerimaan hanya boleh dinyatakan "belum diterima" SEKALI; kunci idempotensi unik per penerimaan (klik ganda koreksi = satu baris).
CREATE UNIQUE INDEX "unit_workshop_receipt_corrections_void_once_key" ON "unit_workshop_receipt_corrections"("receipt_id") WHERE "kind" = 'NOT_RECEIVED';
CREATE UNIQUE INDEX "unit_workshop_receipt_corrections_idem_key" ON "unit_workshop_receipt_corrections"("receipt_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL;
ALTER TABLE "unit_workshop_receipt_corrections" ADD CONSTRAINT "unit_workshop_receipt_corrections_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "unit_workshop_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "unit_workshop_receipt_corrections" ADD CONSTRAINT "unit_workshop_receipt_corrections_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TRIGGER "unit_workshop_receipt_corrections_append_only_trg" BEFORE UPDATE OR DELETE ON "unit_workshop_receipt_corrections"
FOR EACH ROW EXECUTE FUNCTION production_adopsi_append_only();
