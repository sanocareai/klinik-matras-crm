-- KOREKSI DOKUMEN GUDANG (Okt 2026) — migrasi ADITIF: 1 tabel baru (kosong) + 2 kolom NULL pada stock_movements. Tanpa backfill, tanpa perubahan data lama.
-- Dokumen yang sudah diposting tidak diubah/dihapus; koreksi adalah dokumen sendiri yang bertaut ke dokumen asal dan menghasilkan pergerakan pembalik/selisih.

CREATE TABLE "warehouse_corrections" (
    "id" UUID NOT NULL,
    "correction_number" VARCHAR(40) NOT NULL,
    "doc_type" VARCHAR(30) NOT NULL,
    "doc_id" UUID NOT NULL,
    "doc_number" VARCHAR(60) NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "reason" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "preview" JSONB NOT NULL,
    "doc_token" VARCHAR(80) NOT NULL,
    "requested_by" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by" TEXT,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,
    "idempotency_key" VARCHAR(120) NOT NULL,
    "result" JSONB,

    CONSTRAINT "warehouse_corrections_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "stock_movements" ADD COLUMN "correction_id" UUID,
ADD COLUMN "corrects_movement_id" UUID;

CREATE UNIQUE INDEX "warehouse_corrections_correction_number_key" ON "warehouse_corrections"("correction_number");
CREATE UNIQUE INDEX "warehouse_corrections_idempotency_key_key" ON "warehouse_corrections"("idempotency_key");
CREATE INDEX "warehouse_corrections_doc_type_doc_id_requested_at_idx" ON "warehouse_corrections"("doc_type", "doc_id", "requested_at");
CREATE INDEX "warehouse_corrections_status_requested_at_idx" ON "warehouse_corrections"("status", "requested_at");
CREATE INDEX "stock_movements_correction_id_idx" ON "stock_movements"("correction_id");
CREATE INDEX "stock_movements_corrects_movement_id_idx" ON "stock_movements"("corrects_movement_id");

ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_correction_id_fkey" FOREIGN KEY ("correction_id") REFERENCES "warehouse_corrections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_corrects_movement_id_fkey" FOREIGN KEY ("corrects_movement_id") REFERENCES "stock_movements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "warehouse_corrections" ADD CONSTRAINT "warehouse_corrections_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "warehouse_corrections" ADD CONSTRAINT "warehouse_corrections_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Pagar bentuk data (diuji di tes integrasi; penegakan utama tetap di layanan).
ALTER TABLE "warehouse_corrections" ADD CONSTRAINT "warehouse_corrections_jenis_chk" CHECK ("doc_type" IN ('GOODS_RECEIPT') AND "kind" IN ('METADATA', 'STOCK') AND "status" IN ('PENDING_APPROVAL', 'POSTED', 'REJECTED', 'CANCELLED'));
ALTER TABLE "warehouse_corrections" ADD CONSTRAINT "warehouse_corrections_alasan_chk" CHECK (length(btrim("reason")) >= 5);
-- Koreksi metadata tidak menunggu persetujuan (tidak mengubah stok): langsung POSTED. Koreksi stok: pemohon ≠ penyetuju (dibaca dari kolom, bukan dari klien).
ALTER TABLE "warehouse_corrections" ADD CONSTRAINT "warehouse_corrections_keputusan_chk" CHECK (
  (("status" = 'PENDING_APPROVAL') = ("decided_at" IS NULL))
  AND ("kind" <> 'METADATA' OR "status" = 'POSTED')
  AND ("kind" <> 'STOCK' OR "status" <> 'POSTED' OR ("decided_by" IS NOT NULL AND "decided_by" IS DISTINCT FROM "requested_by"))
);
-- Pergerakan koreksi: wajib bertaut ke dokumen koreksi; tidak boleh menunjuk dirinya sendiri.
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_koreksi_chk" CHECK (("corrects_movement_id" IS NULL OR "correction_id" IS NOT NULL) AND ("corrects_movement_id" IS NULL OR "corrects_movement_id" <> "id"));

-- Append-only: tidak bisa dihapus; sesudah keputusan (POSTED/REJECTED/CANCELLED) tidak ada kolom yang boleh berubah; selagi PENDING hanya kolom keputusan yang boleh diisi.
CREATE OR REPLACE FUNCTION warehouse_corrections_append_only() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'warehouse_corrections bersifat append-only (DELETE ditolak)';
  END IF;
  IF OLD.status <> 'PENDING_APPROVAL' THEN
    RAISE EXCEPTION 'warehouse_corrections: koreksi berstatus % sudah final dan tidak boleh diubah', OLD.status;
  END IF;
  IF ROW(NEW.id, NEW.correction_number, NEW.doc_type, NEW.doc_id, NEW.doc_number, NEW.kind, NEW.reason, NEW.changes, NEW.preview, NEW.doc_token, NEW.requested_by, NEW.requested_at, NEW.idempotency_key)
     IS DISTINCT FROM
     ROW(OLD.id, OLD.correction_number, OLD.doc_type, OLD.doc_id, OLD.doc_number, OLD.kind, OLD.reason, OLD.changes, OLD.preview, OLD.doc_token, OLD.requested_by, OLD.requested_at, OLD.idempotency_key) THEN
    RAISE EXCEPTION 'warehouse_corrections: isi koreksi tidak boleh diubah (hanya keputusan)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "warehouse_corrections_append_only_trg" BEFORE UPDATE OR DELETE ON "warehouse_corrections"
FOR EACH ROW EXECUTE FUNCTION warehouse_corrections_append_only();

-- AKSES BACA: role mcp_hub_readonly (konektor SANO Hub Analytics) memperoleh SELECT otomatis pada tabel baru lewat ALTER DEFAULT PRIVILEGES. Tabel koreksi memuat alasan, aktor, dan
-- nilai sebelum/sesudah dokumen Gudang — bukan kebutuhan konektor itu, maka dicabut (hanya bila role ada). Role aplikasi (pemilik) tidak terpengaruh.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_hub_readonly') THEN
    REVOKE ALL ON TABLE "warehouse_corrections" FROM "mcp_hub_readonly";
  END IF;
END
$$;
