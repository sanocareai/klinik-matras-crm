-- GABUNGKAN ORDER DUPLIKAT (kasus Indra, 14 Okt 2026): order duplikat TIDAK dihapus; ia diberi relasi "digabungkan ke order utama". Aditif: 4 kolom NULL pada "Order"
-- (semua baris tetap NULL = tidak digabung), 1 tabel audit append-only KOSONG. Tanpa backfill, tanpa UPDATE/DELETE pada data yang ada.
ALTER TABLE "Order" ADD COLUMN "merged_into_order_id" TEXT;
ALTER TABLE "Order" ADD COLUMN "merged_at" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "merged_by_id" TEXT;
ALTER TABLE "Order" ADD COLUMN "merge_reason" VARCHAR(500);

ALTER TABLE "Order" ADD CONSTRAINT "Order_merged_into_order_id_fkey" FOREIGN KEY ("merged_into_order_id") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_merge_bukan_diri_sendiri_chk" CHECK ("merged_into_order_id" IS NULL OR "merged_into_order_id" <> "id");
CREATE INDEX "Order_merged_into_order_id_idx" ON "Order"("merged_into_order_id");

CREATE TABLE "order_merges" (
    "id" UUID NOT NULL,
    "primary_order_id" TEXT NOT NULL,
    "duplicate_order_id" TEXT NOT NULL,
    "actor_id" TEXT,
    "reason" VARCHAR(500) NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "evidence" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_merges_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "order_merges_alasan_chk" CHECK (length(btrim("reason")) >= 5),
    CONSTRAINT "order_merges_beda_order_chk" CHECK ("primary_order_id" <> "duplicate_order_id")
);

CREATE UNIQUE INDEX "order_merges_duplicate_order_id_key" ON "order_merges"("duplicate_order_id");
CREATE UNIQUE INDEX "order_merges_idempotency_key_key" ON "order_merges"("idempotency_key");
CREATE INDEX "order_merges_primary_order_id_idx" ON "order_merges"("primary_order_id");

ALTER TABLE "order_merges" ADD CONSTRAINT "order_merges_primary_order_id_fkey" FOREIGN KEY ("primary_order_id") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_merges" ADD CONSTRAINT "order_merges_duplicate_order_id_fkey" FOREIGN KEY ("duplicate_order_id") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_merges" ADD CONSTRAINT "order_merges_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Buku penggabungan APPEND-ONLY: tidak boleh diubah/dihapus (pembatalan penggabungan = keputusan data terpisah dengan backup).
CREATE OR REPLACE FUNCTION order_merges_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'order_merges append-only: baris % tidak boleh diubah atau dihapus', OLD."id" USING ERRCODE = 'restrict_violation';
END $$;
CREATE TRIGGER order_merges_append_only_trg BEFORE UPDATE OR DELETE ON "order_merges" FOR EACH ROW EXECUTE FUNCTION order_merges_append_only();
