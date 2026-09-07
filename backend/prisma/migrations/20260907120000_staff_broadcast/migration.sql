-- Staff Broadcast (7 September 2026) — broadcast manual admin/leader ke WA
-- pribadi sales (mis. "meeting tanggal X"), dengan jadwal kirim. Lihat
-- catatan panjang di schema.prisma model StaffBroadcast untuk kenapa ini
-- SATU tabel (tanpa tabel target terpisah, beda dari BroadcastCampaign/
-- BroadcastTarget yang untuk pelanggan) — skalanya kecil (maks jumlah sales
-- aktif per broadcast), hasil per-penerima cukup JSON di kolom `results`.
--
-- ADITIF MURNI: satu enum baru + satu tabel baru + satu relasi baru
-- (createdById -> User, SetNull). Tidak ada kolom/data lama yang disentuh.
--
-- Rollback manual:
--   DROP TABLE "staff_broadcasts";
--   DROP TYPE "StaffBroadcastStatus";

-- CreateEnum
CREATE TYPE "StaffBroadcastStatus" AS ENUM ('SCHEDULED', 'SENT', 'CANCELLED');

-- CreateTable
CREATE TABLE "staff_broadcasts" (
    "id"             TEXT NOT NULL,
    "message"        TEXT NOT NULL,
    "recipient_ids"  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "scheduled_at"   TIMESTAMP(3) NOT NULL,
    "status"         "StaffBroadcastStatus" NOT NULL DEFAULT 'SCHEDULED',
    "results"        JSONB,
    "created_by_id"  TEXT,
    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at"        TIMESTAMP(3),

    CONSTRAINT "staff_broadcasts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "staff_broadcasts_status_scheduled_at_idx" ON "staff_broadcasts"("status", "scheduled_at");

-- AddForeignKey
ALTER TABLE "staff_broadcasts" ADD CONSTRAINT "staff_broadcasts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
