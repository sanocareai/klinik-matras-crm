-- Tambah field isRead + readAt ke Conversation
-- isRead: true kalau chat sudah dibuka (di CRM atau di HP via ack webhook)
-- readAt: timestamp kapan terakhir dibaca

ALTER TABLE "Conversation" ADD COLUMN "isRead" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Conversation" ADD COLUMN "readAt" TIMESTAMP(3);
