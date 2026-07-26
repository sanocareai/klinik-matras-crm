-- Riwayat perpindahan STATUS ORDER (sisi PENGERJAAN), pasangan dari
-- pipeline_transitions yang mencatat sisi PENJUALAN.
--
-- Append-only, TIDAK bisa di-backfill: perpindahan status sebelum migrasi ini
-- tidak pernah terekam, jadi laporan kecepatan produksi baru bermakna setelah
-- beberapa minggu pemakaian. Ini pola & keterbatasan yang sama seperti
-- pipeline_transitions (lihat migration 20260725100000).
--
-- ROLLBACK MANUAL kalau perlu:
--   DROP TABLE "order_status_transitions";

CREATE TABLE "order_status_transitions" (
    "id" UUID NOT NULL,
    "order_id" TEXT NOT NULL,
    "from_status" "OrderStatus" NOT NULL,
    "to_status" "OrderStatus" NOT NULL,
    "changed_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_status_transitions_pkey" PRIMARY KEY ("id")
);

-- Timeline per order (dipakai drawer detail order).
CREATE INDEX "order_status_transitions_order_id_created_at_idx" ON "order_status_transitions"("order_id", "created_at");

-- Agregasi "berapa order masuk status X per periode" (laporan produksi).
CREATE INDEX "order_status_transitions_to_status_created_at_idx" ON "order_status_transitions"("to_status", "created_at");

-- Cascade: riwayat ikut terhapus kalau ORDER-nya dihapus (riwayat tanpa order
-- tidak punya makna). Order sendiri RESTRICT ke Customer, jadi merge customer
-- yang masih punya order gagal keras — bukan menghapus riwayat diam-diam.
ALTER TABLE "order_status_transitions" ADD CONSTRAINT "order_status_transitions_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SetNull: user dihapus (pegawai resign) TIDAK boleh menghapus riwayat produksi.
ALTER TABLE "order_status_transitions" ADD CONSTRAINT "order_status_transitions_changed_by_fkey"
    FOREIGN KEY ("changed_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Index pendukung papan Order per status + laporan antrean produksi.
CREATE INDEX "Order_status_createdAt_idx" ON "Order"("status", "createdAt");
