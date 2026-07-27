-- Kolom clientId di Message — dedupe kirim pesan (lihat komentar panjang di
-- schema.prisma & routes/conversations.js POST /:id/messages). Sebelumnya
-- clientId cuma dipakai rekonsiliasi optimistic-UI client-side, TIDAK
-- PERNAH disimpan/dicek server — retry outbox mobile (timeout HTTP padahal
-- sendText() ke WAHA sudah berhasil) mengirim pesan yang SAMA ke WhatsApp
-- berkali-kali. Nullable, unique, tidak perlu backfill (pesan lama tidak
-- pernah punya clientId, memang tidak butuh dedup retroaktif).
ALTER TABLE "Message" ADD COLUMN "clientId" TEXT;
CREATE UNIQUE INDEX "Message_clientId_key" ON "Message"("clientId");
