-- TRANSISI SATUAN BAHAN (Nov 2026). ADITIF: 2 kolom nullable di stock_movements, 1 tabel dokumen baru (append-only), 2 trigger. Tidak mengubah, mengisi ulang, atau menghapus satu pun baris yang sudah ada;
-- tidak menulis stok/jurnal/valuasi/harga/PO/GR.
--
-- Mengapa perlu struktur baru: ledger menyimpan qty TANPA satuan; satuannya = materials.unit. Mengganti materials.unit begitu saja membuat seluruh riwayat berlabel satuan baru (saldo lama dengan label baru).
-- Desain: (1) setiap pergerakan baru membawa satuan saat dicatat (unit_at_entry, diisi trigger dari master dengan FOR SHARE sehingga serentak dengan transisi tidak bisa salah satuan);
-- (2) transisi = satu transaksi: tutup saldo lama (ADJUSTMENT bersatuan lama) + ganti satuan master + buka saldo awal (ADJUSTMENT bersatuan baru), sehingga SUM(qty) langsung berupa saldo dalam satuan baru;
-- (3) dokumen transisi append-only menyimpan satuan lama/baru, saldo lama, sidik jari pergerakan, hash pratinjau yang disetujui, dan kewajiban konversi terbuka;
-- (4) materials.unit hanya boleh berubah untuk bahan yang SUDAH punya pergerakan bila transaksinya mengaktifkan penanda transisi (SET LOCAL app.transisi_satuan) — tidak ada jalan diam-diam lain.
-- Pergerakan sebelum migrasi tetap NULL (tidak diisi ulang): satuannya = satuan_lama transisi pertama bahan itu bila ada, selain itu satuan master sekarang.

ALTER TABLE "stock_movements" ADD COLUMN "unit_at_entry" "MaterialUnit";
ALTER TABLE "stock_movements" ADD COLUMN "unit_transition_id" UUID;

CREATE TABLE "material_unit_transitions" (
  "id" UUID NOT NULL,
  "material_id" UUID NOT NULL,
  "from_unit" "MaterialUnit" NOT NULL,
  "to_unit" "MaterialUnit" NOT NULL,
  "balance_old" DECIMAL(14,4) NOT NULL,
  "balance_new" DECIMAL(14,4) NOT NULL,
  "movement_count" INTEGER NOT NULL,
  "movements_digest" TEXT NOT NULL,
  "preview_hash" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "reference_hash" TEXT NOT NULL,
  "open_obligations" JSONB NOT NULL DEFAULT '[]',
  "close_movement_id" UUID,
  "open_movement_id" UUID,
  "idempotency_key" TEXT NOT NULL,
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "material_unit_transitions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "material_unit_transitions_beda_satuan_chk" CHECK ("from_unit" <> "to_unit"),
  CONSTRAINT "material_unit_transitions_saldo_baru_chk" CHECK ("balance_new" >= 0),
  CONSTRAINT "material_unit_transitions_gerakan_chk" CHECK ("movement_count" >= 0)
);
CREATE UNIQUE INDEX "material_unit_transitions_idempotency_key_key" ON "material_unit_transitions"("idempotency_key");
CREATE INDEX "material_unit_transitions_material_id_created_at_idx" ON "material_unit_transitions"("material_id", "created_at");
ALTER TABLE "material_unit_transitions" ADD CONSTRAINT "material_unit_transitions_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION material_unit_transitions_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% append-only: dokumen transisi satuan tidak boleh diubah atau dihapus', TG_TABLE_NAME;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER "material_unit_transitions_append_only_trg" BEFORE UPDATE OR DELETE ON "material_unit_transitions" FOR EACH ROW EXECUTE FUNCTION material_unit_transitions_append_only();

-- Satuan saat dicatat: pergerakan tanpa penanda eksplisit diberi satuan master SAAT INI. FOR SHARE bertabrakan dengan kunci UPDATE transaksi transisi, sehingga penulis serentak menunggu transisi selesai lalu
-- membaca satuan yang BENAR (READ COMMITTED membaca ulang versi baris terbaru); tidak mungkin ada pergerakan berlabel satuan lama yang tertulis sesudah penutupan saldo lama.
CREATE OR REPLACE FUNCTION stock_movements_stamp_unit() RETURNS trigger AS $$
BEGIN
  IF NEW."unit_at_entry" IS NULL THEN
    SELECT "unit" INTO NEW."unit_at_entry" FROM "materials" WHERE "id" = NEW."material_id" FOR SHARE;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER "stock_movements_stamp_unit_trg" BEFORE INSERT ON "stock_movements" FOR EACH ROW EXECUTE FUNCTION stock_movements_stamp_unit();

-- Pagar: satuan master bahan yang sudah punya pergerakan HANYA boleh berubah di dalam transaksi transisi (app.transisi_satuan di-set oleh layanan, per transaksi). Bahan tanpa pergerakan tetap bebas (Perbaiki SKU).
CREATE OR REPLACE FUNCTION materials_unit_guard() RETURNS trigger AS $$
BEGIN
  IF NEW."unit" IS DISTINCT FROM OLD."unit"
     AND EXISTS (SELECT 1 FROM "stock_movements" WHERE "material_id" = OLD."id")
     AND COALESCE(current_setting('app.transisi_satuan', true), '') = '' THEN
    RAISE EXCEPTION 'Satuan bahan % tidak boleh diubah langsung: sudah punya pergerakan stok. Gunakan transisi satuan (menutup saldo lama dan membuka saldo baru dalam satu transaksi).', OLD."code";
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER "materials_unit_guard_trg" BEFORE UPDATE OF "unit" ON "materials" FOR EACH ROW EXECUTE FUNCTION materials_unit_guard();
