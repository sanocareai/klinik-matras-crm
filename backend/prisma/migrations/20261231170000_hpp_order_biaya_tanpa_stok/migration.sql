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
  "harga_satuan" DECIMAL(18,4),
  "nilai" DECIMAL(18,2),
  "price_id" UUID,
  "basis_harga" VARCHAR(40) NOT NULL,
  "sidik_harga" TEXT NOT NULL,
  "sumber_jenis" VARCHAR(24) NOT NULL,
  "sumber_ref" TEXT,
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
  CONSTRAINT "obts_status_harga" CHECK (("status_harga" = 'DINILAI' AND "harga_satuan" IS NOT NULL AND "nilai" IS NOT NULL) OR ("status_harga" = 'TANPA_HARGA' AND "harga_satuan" IS NULL AND "nilai" IS NULL)),
  CONSTRAINT "obts_sumber" CHECK ("sumber_jenis" IN ('CATATAN_HISTORIS','LAPORAN_PIC','DOKUMEN')),
  CONSTRAINT "obts_pemutus_beda" CHECK ("diputuskan_oleh" IS NULL OR "status" = 'DIBATALKAN' OR "diputuskan_oleh" <> "diajukan_oleh")
);
CREATE UNIQUE INDEX "order_biaya_tanpa_stok_idempotency_key_key" ON "order_biaya_tanpa_stok"("idempotency_key");
CREATE INDEX "order_biaya_tanpa_stok_unit_id_status_idx" ON "order_biaya_tanpa_stok"("unit_id", "status");
CREATE INDEX "order_biaya_tanpa_stok_order_id_status_idx" ON "order_biaya_tanpa_stok"("order_id", "status");
CREATE INDEX "order_biaya_tanpa_stok_material_id_status_idx" ON "order_biaya_tanpa_stok"("material_id", "status");
-- Pencegah ganda di tingkat database: satu biaya DISETUJUI per unit + bahan + tanggal pemakaian; satu catatan historis hanya boleh menjadi sumber satu biaya aktif.
CREATE UNIQUE INDEX "obts_satu_disetujui" ON "order_biaya_tanpa_stok"("unit_id", "material_id", "tanggal_pemakaian") WHERE "status" = 'DISETUJUI';
CREATE UNIQUE INDEX "obts_satu_sumber_catatan" ON "order_biaya_tanpa_stok"("sumber_ref") WHERE "sumber_jenis" = 'CATATAN_HISTORIS' AND "status" IN ('DIAJUKAN','DISETUJUI') AND "menggantikan_id" IS NULL;
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
     OR NEW.so_tanggal <> OLD.so_tanggal OR NEW.status_harga <> OLD.status_harga OR NEW.harga_satuan IS DISTINCT FROM OLD.harga_satuan OR NEW.nilai IS DISTINCT FROM OLD.nilai
     OR NEW.sumber_jenis <> OLD.sumber_jenis OR NEW.sumber_ref IS DISTINCT FROM OLD.sumber_ref OR NEW.bukti <> OLD.bukti OR NEW.alasan <> OLD.alasan OR NEW.diajukan_oleh <> OLD.diajukan_oleh
     OR NEW.idempotency_key <> OLD.idempotency_key OR NEW.menggantikan_id IS DISTINCT FROM OLD.menggantikan_id OR NEW.sidik_harga <> OLD.sidik_harga THEN
    RAISE EXCEPTION 'isi order_biaya_tanpa_stok tidak boleh diubah (immutable); koreksi lewat entri pengganti';
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
