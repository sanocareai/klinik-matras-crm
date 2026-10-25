-- BIAYA IKLAN TINGKAT SUMBER (input manual) — Okt 2026. MIGRASI ADITIF: 2 tabel BARU (kosong). Tidak ada kolom/baris lama yang diubah atau dihapus; tidak ada backfill.
--
--   ad_source_spend_entries   : biaya iklan per SUMBER (META/TIKTOK/LAINNYA), bukan per campaign/ad. Dua jenis: HARIAN (satu tanggal WIB) dan TOTAL_RENTANG (nominal untuk rentang tanggal persis;
--                               TIDAK PERNAH diprorata ke hari/campaign). Unik per (sumber, jenis, dari, sampai, akun): input ulang memperbarui entri yang sama (bukan menambah spend ganda).
--                               Rp0 terkonfirmasi = baris dengan nominal 0; "belum diisi" = tidak ada baris. Entri dibatalkan (status DIBATALKAN), tidak dihapus.
--                               override_ad_detail = true hanya bila Admin SENGAJA memilih total manual menggantikan detail Ad (Windsor/API/CSV) untuk rentang itu pada level sumber; selain itu detail Ad menang (tidak dijumlah).
--   ad_source_spend_revisions : jejak append-only setiap perubahan (nilai lama/baru, status lama/baru, alasan, pengubah, waktu). UPDATE/DELETE ditolak trigger.
-- Spend per Ad (meta_ad_daily_spend) TIDAK disentuh; data manual tingkat sumber tidak pernah dialokasikan ke campaign/ad.

CREATE TABLE "ad_source_spend_entries" (
  "id" UUID NOT NULL,
  "source_id" VARCHAR(16) NOT NULL,
  "kind" VARCHAR(16) NOT NULL,
  "date_from" DATE NOT NULL,
  "date_to" DATE NOT NULL,
  "account_id" VARCHAR(32) NOT NULL DEFAULT '',
  "currency" VARCHAR(3) NOT NULL DEFAULT 'IDR',
  "amount" DECIMAL(18,2) NOT NULL,
  "override_ad_detail" BOOLEAN NOT NULL DEFAULT false,
  "status" VARCHAR(12) NOT NULL DEFAULT 'AKTIF',
  "reason" VARCHAR(300) NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "created_by_id" TEXT,
  "updated_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ad_source_spend_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ad_source_spend_entries_source_chk" CHECK ("source_id" IN ('META','TIKTOK','LAINNYA')),
  CONSTRAINT "ad_source_spend_entries_kind_chk" CHECK ("kind" IN ('HARIAN','TOTAL_RENTANG')),
  CONSTRAINT "ad_source_spend_entries_status_chk" CHECK ("status" IN ('AKTIF','DIBATALKAN')),
  CONSTRAINT "ad_source_spend_entries_amount_chk" CHECK ("amount" >= 0),
  CONSTRAINT "ad_source_spend_entries_idr_chk" CHECK ("currency" = 'IDR'),
  CONSTRAINT "ad_source_spend_entries_range_chk" CHECK ("date_from" <= "date_to" AND ("kind" <> 'HARIAN' OR "date_from" = "date_to")),
  CONSTRAINT "ad_source_spend_entries_override_chk" CHECK ("override_ad_detail" = false OR "source_id" = 'META')
);
CREATE UNIQUE INDEX "ad_source_spend_entries_key" ON "ad_source_spend_entries"("source_id", "kind", "date_from", "date_to", "account_id");
CREATE INDEX "ad_source_spend_entries_source_date_idx" ON "ad_source_spend_entries"("source_id", "date_from", "date_to");

CREATE TABLE "ad_source_spend_revisions" (
  "id" UUID NOT NULL,
  "entry_id" UUID NOT NULL,
  "revision" INTEGER NOT NULL,
  "action" VARCHAR(16) NOT NULL,
  "prev_amount" DECIMAL(18,2),
  "new_amount" DECIMAL(18,2) NOT NULL,
  "prev_status" VARCHAR(12),
  "new_status" VARCHAR(12) NOT NULL,
  "prev_override" BOOLEAN,
  "new_override" BOOLEAN NOT NULL,
  "reason" VARCHAR(300) NOT NULL,
  "changed_by_id" TEXT,
  "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ad_source_spend_revisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ad_source_spend_revisions_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "ad_source_spend_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ad_source_spend_revisions_action_chk" CHECK ("action" IN ('BUAT','UBAH','BATAL','AKTIFKAN'))
);
CREATE UNIQUE INDEX "ad_source_spend_revisions_entry_rev" ON "ad_source_spend_revisions"("entry_id", "revision");

CREATE FUNCTION "ad_source_spend_revisions_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'ad_source_spend_revisions bersifat append-only'; END; $$;
CREATE TRIGGER "ad_source_spend_revisions_no_update" BEFORE UPDATE OR DELETE ON "ad_source_spend_revisions" FOR EACH ROW EXECUTE FUNCTION "ad_source_spend_revisions_append_only"();
