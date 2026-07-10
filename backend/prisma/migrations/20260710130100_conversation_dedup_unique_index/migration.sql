-- Fix race condition: 2 event webhook (message + message.any) bisa tiba
-- <1ms terpisah dan sama-sama gagal menemukan Conversation aktif yang sama
-- sebelum salah satunya selesai INSERT, menghasilkan Conversation dobel
-- untuk 1 customer (bukti produksi: FX BENZ — 2 Conversation, createdAt
-- beda 1ms, satu sessionId null 0 pesan, satu CS-2 10 pesan).
--
-- ⚠️ URUTAN WAJIB — migration ini akan GAGAL kalau data duplikat masih ada:
--   1. JALANKAN DULU:  node scripts/dedup-conversations.js --dry-run
--                      (review output, lalu tanpa --dry-run untuk terapkan)
--   2. BARU JALANKAN:  npx prisma migrate deploy
--
-- Partial unique index (BUKAN unique polos) — customer yang percakapannya
-- di-"Tandai Selesai" (RESOLVED) harus tetap bisa dapat Conversation BARU
-- saat chat lagi nanti (alur ini sudah dipakai di 3 tempat di webhooks.js).
-- Jadi constraint HANYA berlaku untuk Conversation yang masih AKTIF
-- (status != 'RESOLVED') — boleh ada banyak Conversation RESOLVED lama
-- untuk 1 customer/grup yang sama, tapi cuma 1 yang aktif di satu waktu.

-- INDIVIDUAL: 1 Conversation AKTIF per customerId+channel
CREATE UNIQUE INDEX "Conversation_customerId_channel_active_unique"
  ON "Conversation" ("customerId", "channel")
  WHERE status != 'RESOLVED';

-- GROUP: 1 Conversation AKTIF per groupJid
CREATE UNIQUE INDEX "Conversation_groupJid_active_unique"
  ON "Conversation" ("groupJid")
  WHERE status != 'RESOLVED';
