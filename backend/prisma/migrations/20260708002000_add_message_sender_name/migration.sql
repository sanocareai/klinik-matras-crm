-- Tambah kolom senderName ke Message untuk menyimpan nama pengirim pesan grup
ALTER TABLE "Message" ADD COLUMN "senderName" TEXT;
