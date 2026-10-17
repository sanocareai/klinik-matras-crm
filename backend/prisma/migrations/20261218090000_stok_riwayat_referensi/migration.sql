-- Riwayat referensi historis dari file (Okt 2026) — ADITIF murni: 2 tabel baru (kosong). Tanpa backfill, tanpa UPDATE/DELETE data lama, tanpa menyentuh stock_movements/saldo/GR/Issue/jurnal.
-- CATATAN REFERENSI, BUKAN TRANSAKSI. tanggal_pemakaian selalu NULL (tidak ada bukti tanggal pemakaian). Append-only: DELETE ditolak; UPDATE hanya boleh membalik aktif true->false (revisi baru).

-- CreateTable
CREATE TABLE "stok_riwayat_impor" (
    "id" UUID NOT NULL,
    "waktu_impor" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "diimpor_oleh" TEXT,
    "berkas_pemakaian" TEXT,
    "hash_pemakaian" TEXT,
    "berkas_pembelian" TEXT,
    "hash_pembelian" TEXT,
    "hash_alias" TEXT,
    "hash_konten" TEXT NOT NULL,
    "mulai_t0" TIMESTAMP(3),
    "ringkasan" JSONB NOT NULL,

    CONSTRAINT "stok_riwayat_impor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stok_riwayat_referensi" (
    "id" UUID NOT NULL,
    "impor_id" UUID NOT NULL,
    "kunci" TEXT NOT NULL,
    "revisi" INTEGER NOT NULL DEFAULT 1,
    "aktif" BOOLEAN NOT NULL DEFAULT true,
    "konten_hash" TEXT NOT NULL,
    "jenis" TEXT NOT NULL,
    "material_id" UUID,
    "nama_di_file" TEXT NOT NULL,
    "nomor_order" TEXT,
    "jumlah" DECIMAL(14,3),
    "satuan_file" TEXT NOT NULL,
    "satuan_master" TEXT,
    "tanggal_order" DATE,
    "tanggal_pemakaian" DATE,
    "tanggal_kirim" DATE,
    "surat_jalan" TEXT,
    "vendor" TEXT,
    "label_bulan_file" TEXT,
    "sumber_file" TEXT NOT NULL,
    "sumber_baris" INTEGER[],
    "status_verifikasi" TEXT NOT NULL,
    "antrean" TEXT,
    "alasan_blocker" TEXT[],
    "peringatan" TEXT[],
    "dokumen_resmi" JSONB,
    "dibuat_pada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stok_riwayat_referensi_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stok_riwayat_impor_waktu_impor_idx" ON "stok_riwayat_impor"("waktu_impor");
CREATE UNIQUE INDEX "stok_riwayat_referensi_kunci_revisi_key" ON "stok_riwayat_referensi"("kunci", "revisi");
CREATE INDEX "stok_riwayat_referensi_material_id_idx" ON "stok_riwayat_referensi"("material_id");
CREATE INDEX "stok_riwayat_referensi_nomor_order_idx" ON "stok_riwayat_referensi"("nomor_order");
CREATE INDEX "stok_riwayat_referensi_aktif_status_verifikasi_idx" ON "stok_riwayat_referensi"("aktif", "status_verifikasi");
CREATE INDEX "stok_riwayat_referensi_aktif_antrean_idx" ON "stok_riwayat_referensi"("aktif", "antrean");

-- AddForeignKey
ALTER TABLE "stok_riwayat_referensi" ADD CONSTRAINT "stok_riwayat_referensi_impor_id_fkey" FOREIGN KEY ("impor_id") REFERENCES "stok_riwayat_impor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stok_riwayat_referensi" ADD CONSTRAINT "stok_riwayat_referensi_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Pagar: tanggal pemakaian tidak pernah boleh terisi (tidak ada bukti); jenis & status dibatasi.
ALTER TABLE "stok_riwayat_referensi" ADD CONSTRAINT "stok_riwayat_referensi_tanpa_tanggal_pemakaian" CHECK ("tanggal_pemakaian" IS NULL);
ALTER TABLE "stok_riwayat_referensi" ADD CONSTRAINT "stok_riwayat_referensi_jenis_chk" CHECK ("jenis" IN ('PEMAKAIAN_ORDER','PENERIMAAN_TERBUKTI_TANPA_GR'));
ALTER TABLE "stok_riwayat_referensi" ADD CONSTRAINT "stok_riwayat_referensi_status_chk" CHECK ("status_verifikasi" IN ('BELUM_DIVERIFIKASI','SUDAH_ADA_DI_RESMI','ADA_DOKUMEN_RESMI_BELUM_DIPOSTING','PERLU_PEMERIKSAAN','PERLU_PENYELESAIAN'));

-- Append-only
CREATE OR REPLACE FUNCTION stok_riwayat_referensi_append_only() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'stok_riwayat_referensi bersifat append-only (DELETE ditolak)';
  END IF;
  IF NEW.aktif = false AND OLD.aktif = true
     AND ROW(NEW.id, NEW.impor_id, NEW.kunci, NEW.revisi, NEW.konten_hash, NEW.jenis, NEW.material_id, NEW.nama_di_file, NEW.nomor_order, NEW.jumlah, NEW.satuan_file, NEW.satuan_master, NEW.tanggal_order, NEW.tanggal_pemakaian, NEW.tanggal_kirim, NEW.surat_jalan, NEW.vendor, NEW.label_bulan_file, NEW.sumber_file, NEW.sumber_baris, NEW.status_verifikasi, NEW.antrean, NEW.alasan_blocker, NEW.peringatan, NEW.dokumen_resmi, NEW.dibuat_pada)
        IS NOT DISTINCT FROM
        ROW(OLD.id, OLD.impor_id, OLD.kunci, OLD.revisi, OLD.konten_hash, OLD.jenis, OLD.material_id, OLD.nama_di_file, OLD.nomor_order, OLD.jumlah, OLD.satuan_file, OLD.satuan_master, OLD.tanggal_order, OLD.tanggal_pemakaian, OLD.tanggal_kirim, OLD.surat_jalan, OLD.vendor, OLD.label_bulan_file, OLD.sumber_file, OLD.sumber_baris, OLD.status_verifikasi, OLD.antrean, OLD.alasan_blocker, OLD.peringatan, OLD.dokumen_resmi, OLD.dibuat_pada) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'stok_riwayat_referensi bersifat append-only (hanya aktif true->false yang boleh)';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "stok_riwayat_referensi_append_only_trg" BEFORE UPDATE OR DELETE ON "stok_riwayat_referensi"
FOR EACH ROW EXECUTE FUNCTION stok_riwayat_referensi_append_only();

CREATE OR REPLACE FUNCTION stok_riwayat_impor_append_only() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'stok_riwayat_impor bersifat append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "stok_riwayat_impor_append_only_trg" BEFORE UPDATE OR DELETE ON "stok_riwayat_impor"
FOR EACH ROW EXECUTE FUNCTION stok_riwayat_impor_append_only();
