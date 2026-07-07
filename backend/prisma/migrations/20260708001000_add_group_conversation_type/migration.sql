-- Tambah enum ConversationType (INDIVIDUAL / GROUP)
CREATE TYPE "ConversationType" AS ENUM ('INDIVIDUAL', 'GROUP');

-- Tambah kolom baru ke tabel Conversation
ALTER TABLE "Conversation"
  ADD COLUMN "type"      "ConversationType" NOT NULL DEFAULT 'INDIVIDUAL',
  ADD COLUMN "groupJid"  TEXT,
  ADD COLUMN "groupName" TEXT;

-- Buat customerId nullable (grup tidak punya customer)
ALTER TABLE "Conversation" ALTER COLUMN "customerId" DROP NOT NULL;

-- Index untuk pencarian conversation berdasarkan groupJid
CREATE INDEX "Conversation_groupJid_idx" ON "Conversation"("groupJid");
