-- PENERIMAAN WORKSHOP OLEH PETUGAS (Okt 2026): catatan resmi "unit diterima di workshop" tanpa mengaktifkan Produksi V2. ADITIF: hanya CREATE TABLE/INDEX/TRIGGER baru.
-- Satu baris per unit (UNIQUE unit_id = klik ganda/serentak menjadi satu catatan). Append-only. TIDAK menulis production_runs_v2 / fase / tahap / QC / stok / jurnal / custody.
-- Dibaca sebagai bukti ke-4 milestone "Diterima di Workshop" (lib/domain/workshopMilestone.js, basis WORKSHOP_RECEIPT).

CREATE TABLE "unit_workshop_receipts" (
  "id" UUID NOT NULL,
  "unit_id" UUID NOT NULL,
  "location_id" UUID NOT NULL,
  "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "received_by_id" TEXT NOT NULL,
  "note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "unit_workshop_receipts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "unit_workshop_receipts_unit_id_key" ON "unit_workshop_receipts"("unit_id");
CREATE INDEX "unit_workshop_receipts_received_at_idx" ON "unit_workshop_receipts"("received_at");
ALTER TABLE "unit_workshop_receipts" ADD CONSTRAINT "unit_workshop_receipts_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "unit_workshop_receipts" ADD CONSTRAINT "unit_workshop_receipts_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "storage_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Append-only (jejak audit): fungsi yang sama dengan tabel adopsi Admin (dibuat migrasi 20261221090000).
CREATE TRIGGER "unit_workshop_receipts_append_only_trg" BEFORE UPDATE OR DELETE ON "unit_workshop_receipts"
FOR EACH ROW EXECUTE FUNCTION production_adopsi_append_only();
