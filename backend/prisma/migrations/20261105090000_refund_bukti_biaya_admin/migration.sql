-- KOREKSI REFUND — BUKTI TRANSFER + REFERENSI TRANSFER (Okt 2026).
-- MIGRASI ADITIF: 1 kolom NULL + 2 tabel baru (kosong) + indeks + FK + CHECK + 2 fungsi/trigger penjaga. Tidak ada baris lama yang diubah/dihapus, TIDAK ADA backfill:
-- semua refund yang sudah ada tetap persis seperti sekarang (transfer_reference NULL, tanpa tautan bukti = "refund lama").
--
-- Biaya admin bank TIDAK butuh kolom baru: fin_refunds.transfer_fee_type/transfer_fee_amount sudah ada sejak 24 Sep 2026 (jurnal: Dr Beban Administrasi Bank).
--
--   fin_refunds.transfer_reference            : nomor referensi transfer (opsional) — membantu deteksi biaya admin ganda.
--   fin_refund_evidences                      : berkas bukti transfer (JPG/PNG/WEBP/PDF). STAGED = sudah diunggah, belum dipakai dokumen; DIGUNAKAN = sudah tertaut
--                                               ke dokumen. Baris DIGUNAKAN TIDAK PERNAH berubah/terhapus (penjaga di bawah).
--   fin_refund_evidence_links                 : relasi EKSPLISIT dokumen refund <-> bukti yang dipakainya (origin BARU = diunggah untuk dokumen ini,
--                                               DIBAWA = bukti dokumen lama yang dipakai kembali). Append-only: bukti dokumen lama tetap melekat ke dokumen lama.

ALTER TABLE "fin_refunds" ADD COLUMN "transfer_reference" VARCHAR(120);

CREATE TABLE "fin_refund_evidences" (
    "id" UUID NOT NULL,
    "stored_name" VARCHAR(64) NOT NULL,
    "original_name" VARCHAR(120) NOT NULL,
    "mime_type" VARCHAR(40) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'STAGED',
    "uploaded_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attached_at" TIMESTAMP(3),

    CONSTRAINT "fin_refund_evidences_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "fin_refund_evidence_links" (
    "id" UUID NOT NULL,
    "refund_id" UUID NOT NULL,
    "evidence_id" UUID NOT NULL,
    "origin" VARCHAR(8) NOT NULL,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_refund_evidence_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fin_refund_evidences_stored_name_key" ON "fin_refund_evidences"("stored_name");
CREATE INDEX "fin_refund_evidences_status_created_at_idx" ON "fin_refund_evidences"("status", "created_at");
CREATE UNIQUE INDEX "fin_refund_evidence_links_refund_id_evidence_id_key" ON "fin_refund_evidence_links"("refund_id", "evidence_id");
CREATE INDEX "fin_refund_evidence_links_evidence_id_idx" ON "fin_refund_evidence_links"("evidence_id");

ALTER TABLE "fin_refund_evidences" ADD CONSTRAINT "fin_refund_evidences_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "fin_refund_evidence_links" ADD CONSTRAINT "fin_refund_evidence_links_refund_id_fkey" FOREIGN KEY ("refund_id") REFERENCES "fin_refunds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fin_refund_evidence_links" ADD CONSTRAINT "fin_refund_evidence_links_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "fin_refund_evidences"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fin_refund_evidence_links" ADD CONSTRAINT "fin_refund_evidence_links_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "fin_refund_evidences" ADD CONSTRAINT "fin_refund_evidences_status_chk" CHECK ("status" IN ('STAGED', 'DIGUNAKAN'));
ALTER TABLE "fin_refund_evidences" ADD CONSTRAINT "fin_refund_evidences_size_chk" CHECK ("size_bytes" > 0 AND "size_bytes" <= 8388608);
ALTER TABLE "fin_refund_evidences" ADD CONSTRAINT "fin_refund_evidences_mime_chk" CHECK ("mime_type" IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf'));
ALTER TABLE "fin_refund_evidences" ADD CONSTRAINT "fin_refund_evidences_attached_chk" CHECK (("status" = 'STAGED' AND "attached_at" IS NULL) OR ("status" = 'DIGUNAKAN' AND "attached_at" IS NOT NULL));
ALTER TABLE "fin_refund_evidence_links" ADD CONSTRAINT "fin_refund_evidence_links_origin_chk" CHECK ("origin" IN ('BARU', 'DIBAWA'));

-- ── penjaga: bukti yang sudah dipakai dokumen tidak pernah berubah / hilang ─────────────────────────────────────
-- uploaded_by_id / created_by_id sengaja TIDAK dijaga: ON DELETE SET NULL pada User harus tetap bisa berjalan.
CREATE FUNCTION "fin_refund_evidence_guard"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'STAGED' THEN
      RAISE EXCEPTION 'REFUND_BUKTI_TETAP: bukti yang sudah dipakai dokumen refund tidak boleh dihapus' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW."stored_name" IS DISTINCT FROM OLD."stored_name" OR NEW."original_name" IS DISTINCT FROM OLD."original_name" OR NEW."mime_type" IS DISTINCT FROM OLD."mime_type"
     OR NEW."size_bytes" IS DISTINCT FROM OLD."size_bytes" OR NEW."sha256" IS DISTINCT FROM OLD."sha256" OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'REFUND_BUKTI_TETAP: isi berkas bukti refund tidak boleh diubah' USING ERRCODE = '23514';
  END IF;
  IF OLD."status" = 'DIGUNAKAN' AND (NEW."status" <> 'DIGUNAKAN' OR NEW."attached_at" IS DISTINCT FROM OLD."attached_at") THEN
    RAISE EXCEPTION 'REFUND_BUKTI_TETAP: bukti yang sudah dipakai dokumen refund tidak boleh dikembalikan ke status sebelumnya' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "fin_refund_evidences_guard_trg" BEFORE UPDATE OR DELETE ON "fin_refund_evidences"
  FOR EACH ROW EXECUTE FUNCTION "fin_refund_evidence_guard"();

CREATE FUNCTION "fin_refund_evidence_link_guard"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'REFUND_BUKTI_TETAP: relasi bukti dokumen refund bersifat append-only' USING ERRCODE = '23514';
  END IF;
  IF NEW."refund_id" IS DISTINCT FROM OLD."refund_id" OR NEW."evidence_id" IS DISTINCT FROM OLD."evidence_id" OR NEW."origin" IS DISTINCT FROM OLD."origin" OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'REFUND_BUKTI_TETAP: relasi bukti dokumen refund bersifat append-only' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "fin_refund_evidence_links_guard_trg" BEFORE UPDATE OR DELETE ON "fin_refund_evidence_links"
  FOR EACH ROW EXECUTE FUNCTION "fin_refund_evidence_link_guard"();
