// Script backfill: isi Conversation.lastMessagePreview & Conversation.unreadCount
// untuk SEMUA percakapan existing dari data Message yang sudah ada (kolom baru
// dari migration 20260709171843_add_session_preview_unreadcount_ack, default-nya
// null/0 untuk row lama).
//
// lastMessagePreview → dari pesan TERAKHIR (createdAt paling baru) di percakapan itu.
// unreadCount        → HEURISTIK, bukan hitungan presisi (tidak ada data historis
//                       "pesan mana yang sudah dibaca per-message", cuma boolean
//                       `unread` + timestamp `readAt` di level conversation):
//                         - kalau conversation.unread === false → unreadCount = 0
//                         - kalau conversation.unread === true  → hitung Message
//                           INBOUND yang createdAt > (readAt ?? conversation.createdAt)
//                       Ini pendekatan terbaik yang bisa direkonstruksi dari model
//                       data sekarang — kemungkinan sedikit meleset untuk percakapan
//                       yang readAt-nya sudah lama/tidak representatif, tapi jauh
//                       lebih baik daripada 0 across the board.
// sessionId           → TIDAK di-backfill (tidak ada cara tahu session WAHA mana
//                       yang menerima pesan lama — field ini historically tidak
//                       direkam). Tetap null untuk conversation lama, cuma percakapan
//                       BARU (setelah Fase F deploy) yang akan terisi otomatis dari
//                       webhook.
//
// JANGAN auto-run — jalankan manual sekali setelah migration di-deploy:
//   docker compose exec backend node scripts/backfill-preview-unread.js

import { prisma } from "../src/db.js";

function buildMessagePreview(content, mediaType) {
  const text = (content || "").trim();
  if (text) return text.length > 80 ? text.slice(0, 80) + "…" : text;
  switch (mediaType) {
    case "image":    return "[Foto]";
    case "video":    return "[Video]";
    case "document": return "[Dokumen]";
    case "audio":    return "[VN]";
    default:         return "";
  }
}

async function main() {
  console.log("=== Backfill lastMessagePreview & unreadCount ===\n");

  const conversations = await prisma.conversation.findMany({
    select: { id: true, unread: true, readAt: true, createdAt: true },
  });
  console.log(`Ditemukan ${conversations.length} percakapan.\n`);

  let updated = 0;
  let skipped = 0;

  for (const conv of conversations) {
    const lastMsg = await prisma.message.findFirst({
      where:   { conversationId: conv.id },
      orderBy: { createdAt: "desc" },
      select:  { content: true, mediaType: true },
    });

    const lastMessagePreview = lastMsg ? buildMessagePreview(lastMsg.content, lastMsg.mediaType) : "";

    let unreadCount = 0;
    if (conv.unread) {
      unreadCount = await prisma.message.count({
        where: {
          conversationId: conv.id,
          direction: "INBOUND",
          createdAt: { gt: conv.readAt || conv.createdAt },
        },
      });
    }

    try {
      await prisma.conversation.update({
        where: { id: conv.id },
        data:  { lastMessagePreview, unreadCount },
      });
      updated++;
    } catch (e) {
      console.warn(`⚠️  Gagal update conversation ${conv.id}:`, e.message);
      skipped++;
    }
  }

  console.log("\n=== RINGKASAN ===");
  console.log(`✅ Berhasil di-update : ${updated} percakapan`);
  console.log(`⚠️  Dilewati (error)  : ${skipped} percakapan`);
  console.log("\nsessionId TIDAK di-backfill (lihat komentar di atas file ini) — tetap null untuk percakapan lama.");
}

main()
  .catch((e) => { console.error("Error:", e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
