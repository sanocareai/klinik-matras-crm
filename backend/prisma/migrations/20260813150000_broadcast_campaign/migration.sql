-- Broadcast / Campaign pindah dari file JSON + antrean setTimeout di memori
-- ke tabel database.
--
-- Alasan lengkap ada di schema.prisma (blok komentar "Broadcast / Campaign").
-- Ringkasnya: antrean di memori hilang total setiap backend restart, tidak
-- ada catatan siapa sudah dikirimi apa (jadi campaign mustahil diukur dan
-- kirim dobel tidak bisa dicegah), dan tidak ada batas harian sama sekali.
--
-- ADITIF MURNI: hanya menambah 2 enum + 2 tabel baru. Tidak ada tabel/kolom
-- lama yang diubah atau dihapus, jadi aman dijalankan di production dengan
-- data berjalan. Drift lain yang muncul di `prisma migrate diff`
-- (OrderWeightEntry_orderId_idx, Conversation_customerId_channel_idx)
-- SENGAJA TIDAK diikutkan — di luar cakupan perubahan ini.

-- CreateEnum
CREATE TYPE "BroadcastStatus" AS ENUM ('DRAFT', 'BERJALAN', 'JEDA', 'SELESAI');

-- CreateEnum
CREATE TYPE "BroadcastTargetStatus" AS ENUM ('MENUNGGU', 'TERKIRIM', 'GAGAL', 'DILEWATI');

-- CreateTable
CREATE TABLE "broadcast_campaigns" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "BroadcastStatus" NOT NULL DEFAULT 'DRAFT',
    "daily_cap" INTEGER NOT NULL DEFAULT 50,
    "filters" JSONB,
    "tag_on_send" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "broadcast_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "broadcast_targets" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "status" "BroadcastTargetStatus" NOT NULL DEFAULT 'MENUNGGU',
    "sent_at" TIMESTAMP(3),
    "error" TEXT,
    "urutan" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "broadcast_targets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "broadcast_campaigns_status_idx" ON "broadcast_campaigns"("status");

-- CreateIndex
CREATE INDEX "broadcast_targets_campaign_id_status_idx" ON "broadcast_targets"("campaign_id", "status");

-- CreateIndex
CREATE INDEX "broadcast_targets_sent_at_idx" ON "broadcast_targets"("sent_at");

-- CreateIndex
CREATE UNIQUE INDEX "broadcast_targets_campaign_id_customer_id_key" ON "broadcast_targets"("campaign_id", "customer_id");

-- AddForeignKey
ALTER TABLE "broadcast_targets" ADD CONSTRAINT "broadcast_targets_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "broadcast_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcast_targets" ADD CONSTRAINT "broadcast_targets_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
