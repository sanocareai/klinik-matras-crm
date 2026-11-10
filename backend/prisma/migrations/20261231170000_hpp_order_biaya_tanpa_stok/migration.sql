-- HPP PER ORDER (Nov 2026): biaya bahan per order TANPA pengurangan stok (pemakaian pada/sebelum SO bertaut) + konfirmasi pemakaian unit lengkap.
-- ADITIF: tabel baru saja. Tidak mengubah stok, jurnal, saldo, cutover, atau tabel lama. Tidak ada data yang diisi.
CREATE TABLE "order_biaya_tanpa_stok" (
  "id" UUID NOT NULL,
  "unit_id" UUID NOT NULL,
  "order_id" TEXT NOT NULL,
  "material_id" UUID NOT NULL,
  "qty" DECIMAL(14,4) NOT NULL,
  "satuan" VARCHAR(20) NOT NULL,
  "tanggal_pemakaian" DATE NOT NULL,
  "so_tanggal" DATE NOT NULL,
  "so_tautan_id" TEXT,
  "status_harga" VARCHAR(16) NOT NULL,
  "waktu_pemakaian" TIMESTAMP(3),
  "kandidat_harga" JSONB,
  "keputusan_harga_oleh" TEXT,
  "keputusan_harga_alasan" TEXT,
  "harga_satuan" DECIMAL(18,4),
  "nilai" DECIMAL(18,2),
  "price_id" UUID,
  "basis_harga" VARCHAR(40) NOT NULL,
  "sidik_harga" TEXT NOT NULL,
  "sumber_jenis" VARCHAR(24) NOT NULL,
  "sumber_ref" TEXT NOT NULL,
  "sidik_ganda" TEXT NOT NULL,
  "kandidat_ganda" JSONB,
  "bukti" TEXT NOT NULL,
  "alasan" TEXT NOT NULL,
  "status" VARCHAR(12) NOT NULL DEFAULT 'DIAJUKAN',
  "menggantikan_id" UUID,
  "diajukan_oleh" TEXT NOT NULL,
  "diajukan_pada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "diputuskan_oleh" TEXT,
  "diputuskan_pada" TIMESTAMP(3),
  "catatan_keputusan" TEXT,
  "idempotency_key" TEXT NOT NULL,
  CONSTRAINT "order_biaya_tanpa_stok_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "obts_qty_positif" CHECK ("qty" > 0),
  CONSTRAINT "obts_pra_so" CHECK ("tanggal_pemakaian" <= "so_tanggal"),
  CONSTRAINT "obts_status" CHECK ("status" IN ('DIAJUKAN','DISETUJUI','DITOLAK','DIBATALKAN','DIGANTI')),
  -- DINILAI = harga diketahui; TANPA_HARGA = belum ada Harga Berlaku (belum diketahui, bukan Rp0); PERLU_KEPUTUSAN = hanya tanggal diketahui dan harga berubah pada hari itu (kandidat disimpan, penyetuju memilih).
  CONSTRAINT "obts_status_harga" CHECK (("status_harga" = 'DINILAI' AND "harga_satuan" IS NOT NULL AND "nilai" IS NOT NULL)
    OR ("status_harga" IN ('TANPA_HARGA','PERLU_KEPUTUSAN') AND "harga_satuan" IS NULL AND "nilai" IS NULL)),
  CONSTRAINT "obts_kandidat_harga" CHECK ("status_harga" <> 'PERLU_KEPUTUSAN' OR "kandidat_harga" IS NOT NULL),
  CONSTRAINT "obts_keputusan_harga" CHECK (("keputusan_harga_oleh" IS NULL) = ("keputusan_harga_alasan" IS NULL)),
  CONSTRAINT "obts_sumber_ref" CHECK (char_length(btrim("sumber_ref")) >= 3),
  CONSTRAINT "obts_sumber" CHECK ("sumber_jenis" IN ('CATATAN_HISTORIS','LAPORAN_PIC','DOKUMEN')),
  CONSTRAINT "obts_pemutus_beda" CHECK ("diputuskan_oleh" IS NULL OR "status" = 'DIBATALKAN' OR "diputuskan_oleh" <> "diajukan_oleh")
);
CREATE UNIQUE INDEX "order_biaya_tanpa_stok_idempotency_key_key" ON "order_biaya_tanpa_stok"("idempotency_key");
CREATE INDEX "order_biaya_tanpa_stok_unit_id_status_idx" ON "order_biaya_tanpa_stok"("unit_id", "status");
CREATE INDEX "order_biaya_tanpa_stok_order_id_status_idx" ON "order_biaya_tanpa_stok"("order_id", "status");
CREATE INDEX "order_biaya_tanpa_stok_material_id_status_idx" ON "order_biaya_tanpa_stok"("material_id", "status");
-- Pencegah ganda di tingkat database BERDASARKAN IDENTITAS SUMBER (bukan unit+bahan+tanggal: pemakaian sah boleh berkali-kali pada hari yang sama):
--   satu sumber (jenis + rujukan baris) hanya punya SATU biaya DISETUJUI dan SATU yang DIAJUKAN; satu entri hanya punya SATU pengganti aktif.
--   Penggantian disetujui dalam satu transaksi: entri lama → DIGANTI dulu, baru pengganti → DISETUJUI (indeks tidak pernah melihat dua yang berlaku).
CREATE UNIQUE INDEX "obts_sumber_satu_disetujui" ON "order_biaya_tanpa_stok"("sumber_jenis", "sumber_ref") WHERE "status" = 'DISETUJUI';
CREATE UNIQUE INDEX "obts_sumber_satu_diajukan" ON "order_biaya_tanpa_stok"("sumber_jenis", "sumber_ref") WHERE "status" = 'DIAJUKAN';
CREATE UNIQUE INDEX "obts_satu_pengganti_aktif" ON "order_biaya_tanpa_stok"("menggantikan_id") WHERE "menggantikan_id" IS NOT NULL AND "status" IN ('DIAJUKAN','DISETUJUI');
ALTER TABLE "order_biaya_tanpa_stok" ADD CONSTRAINT "order_biaya_tanpa_stok_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_biaya_tanpa_stok" ADD CONSTRAINT "order_biaya_tanpa_stok_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_biaya_tanpa_stok" ADD CONSTRAINT "order_biaya_tanpa_stok_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_biaya_tanpa_stok" ADD CONSTRAINT "order_biaya_tanpa_stok_menggantikan_id_fkey" FOREIGN KEY ("menggantikan_id") REFERENCES "order_biaya_tanpa_stok"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "order_biaya_tanpa_stok_events" (
  "id" UUID NOT NULL,
  "entry_id" UUID NOT NULL,
  "kind" VARCHAR(16) NOT NULL,
  "actor_id" TEXT,
  "reason" TEXT,
  "before" JSONB,
  "after" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_biaya_tanpa_stok_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "order_biaya_tanpa_stok_events_entry_id_created_at_idx" ON "order_biaya_tanpa_stok_events"("entry_id", "created_at");
ALTER TABLE "order_biaya_tanpa_stok_events" ADD CONSTRAINT "order_biaya_tanpa_stok_events_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "order_biaya_tanpa_stok"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Isi biaya tidak boleh diubah sesudah diajukan (hanya status + pemutus + catatan keputusan). Tidak ada DELETE. Status final tidak bisa dibuka lagi.
CREATE OR REPLACE FUNCTION obts_jaga() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'order_biaya_tanpa_stok tidak boleh dihapus (immutable)'; END IF;
  IF NEW.unit_id <> OLD.unit_id OR NEW.order_id <> OLD.order_id OR NEW.material_id <> OLD.material_id OR NEW.qty <> OLD.qty OR NEW.tanggal_pemakaian <> OLD.tanggal_pemakaian
     OR NEW.so_tanggal <> OLD.so_tanggal OR NEW.waktu_pemakaian IS DISTINCT FROM OLD.waktu_pemakaian OR NEW.kandidat_harga::text IS DISTINCT FROM OLD.kandidat_harga::text
     OR NEW.sumber_jenis <> OLD.sumber_jenis OR NEW.sumber_ref <> OLD.sumber_ref OR NEW.bukti <> OLD.bukti OR NEW.alasan <> OLD.alasan OR NEW.diajukan_oleh <> OLD.diajukan_oleh
     OR NEW.idempotency_key <> OLD.idempotency_key OR NEW.menggantikan_id IS DISTINCT FROM OLD.menggantikan_id OR NEW.sidik_harga <> OLD.sidik_harga
     OR NEW.sidik_ganda <> OLD.sidik_ganda OR NEW.kandidat_ganda::text IS DISTINCT FROM OLD.kandidat_ganda::text THEN
    RAISE EXCEPTION 'isi order_biaya_tanpa_stok tidak boleh diubah (immutable); koreksi lewat entri pengganti';
  END IF;
  -- Harga hanya boleh berubah SATU KALI: PERLU_KEPUTUSAN → DINILAI pada saat disetujui, dengan pemutus harga + alasan tercatat. Selain itu harga terkunci.
  IF NEW.status_harga <> OLD.status_harga OR NEW.harga_satuan IS DISTINCT FROM OLD.harga_satuan OR NEW.nilai IS DISTINCT FROM OLD.nilai OR NEW.price_id IS DISTINCT FROM OLD.price_id
     OR NEW.basis_harga <> OLD.basis_harga OR NEW.keputusan_harga_oleh IS DISTINCT FROM OLD.keputusan_harga_oleh OR NEW.keputusan_harga_alasan IS DISTINCT FROM OLD.keputusan_harga_alasan THEN
    IF NOT (OLD.status_harga = 'PERLU_KEPUTUSAN' AND NEW.status_harga = 'DINILAI' AND OLD.status = 'DIAJUKAN' AND NEW.status = 'DISETUJUI' AND NEW.keputusan_harga_oleh IS NOT NULL) THEN
      RAISE EXCEPTION 'harga order_biaya_tanpa_stok terkunci (immutable); hanya PERLU_KEPUTUSAN yang diputuskan sekali saat disetujui';
    END IF;
  END IF;
  IF OLD.status IN ('DITOLAK','DIBATALKAN','DIGANTI') THEN RAISE EXCEPTION 'order_biaya_tanpa_stok sudah final (immutable)'; END IF;
  IF OLD.status = 'DISETUJUI' AND NEW.status NOT IN ('DISETUJUI','DIBATALKAN','DIGANTI') THEN RAISE EXCEPTION 'order_biaya_tanpa_stok DISETUJUI hanya bisa dibatalkan atau diganti (immutable)'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER obts_jaga BEFORE UPDATE OR DELETE ON "order_biaya_tanpa_stok" FOR EACH ROW EXECUTE FUNCTION obts_jaga();
CREATE OR REPLACE FUNCTION obts_event_jaga() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'order_biaya_tanpa_stok_events append-only (immutable)'; END $$ LANGUAGE plpgsql;
CREATE TRIGGER obts_event_jaga BEFORE UPDATE OR DELETE ON "order_biaya_tanpa_stok_events" FOR EACH ROW EXECUTE FUNCTION obts_event_jaga();

CREATE TABLE "unit_hpp_konfirmasi" (
  "id" UUID NOT NULL,
  "unit_id" UUID NOT NULL,
  "sidik" TEXT NOT NULL,
  "ringkasan" JSONB NOT NULL,
  "alasan" TEXT NOT NULL,
  "dikonfirmasi_oleh" TEXT NOT NULL,
  "dikonfirmasi_pada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',
  "dicabut_oleh" TEXT,
  "dicabut_pada" TIMESTAMP(3),
  "alasan_cabut" TEXT,
  "idempotency_key" TEXT NOT NULL,
  CONSTRAINT "unit_hpp_konfirmasi_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "uhk_status" CHECK ("status" IN ('ACTIVE','REVOKED'))
);
CREATE UNIQUE INDEX "unit_hpp_konfirmasi_idempotency_key_key" ON "unit_hpp_konfirmasi"("idempotency_key");
CREATE INDEX "unit_hpp_konfirmasi_unit_id_status_idx" ON "unit_hpp_konfirmasi"("unit_id", "status");
CREATE UNIQUE INDEX "uhk_satu_aktif" ON "unit_hpp_konfirmasi"("unit_id") WHERE "status" = 'ACTIVE';
ALTER TABLE "unit_hpp_konfirmasi" ADD CONSTRAINT "unit_hpp_konfirmasi_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE OR REPLACE FUNCTION uhk_jaga() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'unit_hpp_konfirmasi tidak boleh dihapus (immutable)'; END IF;
  IF OLD.status = 'REVOKED' OR NEW.sidik <> OLD.sidik OR NEW.unit_id <> OLD.unit_id OR NEW.dikonfirmasi_oleh <> OLD.dikonfirmasi_oleh OR NEW.ringkasan::text <> OLD.ringkasan::text OR NEW.alasan <> OLD.alasan THEN
    RAISE EXCEPTION 'unit_hpp_konfirmasi hanya boleh dicabut (immutable)';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER uhk_jaga BEFORE UPDATE OR DELETE ON "unit_hpp_konfirmasi" FOR EACH ROW EXECUTE FUNCTION uhk_jaga();
