-- PENGAJUAN PEMAKAIAN BAHAN PRODUKSI (Nov 2026, keputusan Owner): pencatatan pemakaian oleh akun NON-ADMIN (unit V1, perubahan pemakaian, bahan run Produksi V2) disimpan
-- sebagai pengajuan; stok dan HPP BELUM berubah sampai diverifikasi ADMIN yang berbeda. ADITIF: tabel baru + trigger penjaga; tidak mengubah tabel/data lama.
CREATE TABLE "pengajuan_pemakaian_produksi" (
  "id" UUID NOT NULL,
  "jalur" VARCHAR(16) NOT NULL,
  "unit_id" UUID NOT NULL,
  "run_id" TEXT,
  "material_ids" TEXT[] NOT NULL DEFAULT '{}',
  "masukan" JSONB NOT NULL,
  "ringkasan" JSONB NOT NULL,
  "dasar" JSONB NOT NULL,
  "sidik_dasar" TEXT NOT NULL,
  "harga_ambigu" BOOLEAN NOT NULL DEFAULT false,
  "status" VARCHAR(12) NOT NULL DEFAULT 'DIAJUKAN',
  "diajukan_oleh" TEXT NOT NULL,
  "peran_pengaju" TEXT[] NOT NULL DEFAULT '{}',
  "diajukan_pada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "diputuskan_oleh" TEXT,
  "diputuskan_pada" TIMESTAMP(3),
  "alasan_keputusan" TEXT,
  "alasan_tahan" JSONB,
  "hasil" JSONB,
  "idempotency_key" TEXT NOT NULL,
  CONSTRAINT "pengajuan_pemakaian_produksi_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ppp_jalur" CHECK ("jalur" IN ('UNIT_BAHAN','PERUBAHAN','RUN_V2')),
  CONSTRAINT "ppp_status" CHECK ("status" IN ('DIAJUKAN','DITAHAN','DISETUJUI','DITOLAK','DIBATALKAN')),
  CONSTRAINT "ppp_pemutus_beda" CHECK ("diputuskan_oleh" IS NULL OR "status" IN ('DIBATALKAN','DITAHAN') OR "diputuskan_oleh" <> "diajukan_oleh")
);
CREATE UNIQUE INDEX "ppp_kunci_pengaju" ON "pengajuan_pemakaian_produksi"("diajukan_oleh", "idempotency_key");
CREATE INDEX "ppp_status_waktu" ON "pengajuan_pemakaian_produksi"("status", "diajukan_pada");
CREATE INDEX "ppp_unit_status" ON "pengajuan_pemakaian_produksi"("unit_id", "status");
CREATE INDEX "ppp_run_status" ON "pengajuan_pemakaian_produksi"("run_id", "status");
ALTER TABLE "pengajuan_pemakaian_produksi" ADD CONSTRAINT "pengajuan_pemakaian_produksi_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "pengajuan_pemakaian_produksi_events" (
  "id" UUID NOT NULL,
  "pengajuan_id" UUID NOT NULL,
  "kind" VARCHAR(20) NOT NULL,
  "actor_id" TEXT,
  "reason" TEXT,
  "detail" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pengajuan_pemakaian_produksi_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "pppe_pengajuan_waktu" ON "pengajuan_pemakaian_produksi_events"("pengajuan_id", "created_at");
ALTER TABLE "pengajuan_pemakaian_produksi_events" ADD CONSTRAINT "pengajuan_pemakaian_produksi_events_pengajuan_id_fkey" FOREIGN KEY ("pengajuan_id") REFERENCES "pengajuan_pemakaian_produksi"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Isi pengajuan tidak bisa diubah; tidak ada DELETE; status final tidak dibuka lagi. Riwayat append-only.
CREATE OR REPLACE FUNCTION ppp_jaga() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'pengajuan_pemakaian_produksi tidak boleh dihapus (immutable)'; END IF;
  IF NEW.jalur <> OLD.jalur OR NEW.unit_id <> OLD.unit_id OR NEW.run_id IS DISTINCT FROM OLD.run_id OR NEW.masukan::text <> OLD.masukan::text OR NEW.ringkasan::text <> OLD.ringkasan::text
     OR NEW.dasar::text <> OLD.dasar::text OR NEW.sidik_dasar <> OLD.sidik_dasar OR NEW.harga_ambigu <> OLD.harga_ambigu OR NEW.diajukan_oleh <> OLD.diajukan_oleh
     OR NEW.diajukan_pada <> OLD.diajukan_pada OR NEW.idempotency_key <> OLD.idempotency_key THEN
    RAISE EXCEPTION 'isi pengajuan_pemakaian_produksi tidak boleh diubah (immutable)';
  END IF;
  IF OLD.status IN ('DISETUJUI','DITOLAK','DIBATALKAN') THEN RAISE EXCEPTION 'pengajuan_pemakaian_produksi sudah final (immutable)'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER ppp_jaga BEFORE UPDATE OR DELETE ON "pengajuan_pemakaian_produksi" FOR EACH ROW EXECUTE FUNCTION ppp_jaga();
CREATE OR REPLACE FUNCTION pppe_jaga() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'pengajuan_pemakaian_produksi_events append-only (immutable)'; END $$ LANGUAGE plpgsql;
CREATE TRIGGER pppe_jaga BEFORE UPDATE OR DELETE ON "pengajuan_pemakaian_produksi_events" FOR EACH ROW EXECUTE FUNCTION pppe_jaga();
