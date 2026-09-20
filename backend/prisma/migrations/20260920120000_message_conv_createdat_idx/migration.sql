-- Halaman pesan terbaru per percakapan (ORDER BY createdAt DESC LIMIT N) tanpa sort penuh
CREATE INDEX IF NOT EXISTS "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt" DESC);
