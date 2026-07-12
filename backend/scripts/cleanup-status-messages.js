// Bersihkan Message yang kadung masuk dari WhatsApp Status/Story (bug: JID
// broadcast-nya "status@broadcast", BUKAN "status@g.us" — gate lama di
// webhooks.js cuma cek "status@g.us" jadi status lolos, ter-attribusi ke
// SENDER-nya (kontak asli, mis. "Indira Utami") dan masuk sebagai bubble
// chat biasa di conversation customer itu. Lihat fix di webhooks.js,
// parseHistoryMessage.js, reconciliation.js untuk gate-nya — script ini
// HANYA membersihkan data yang SUDAH kadung masuk sebelum fix ada.
//
// ⚠️ VERIFIKASI DULU SEBELUM EKSEKUSI SUNGGUHAN: pola pencarian di bawah
// (externalId mengandung "status@broadcast"/"broadcast") adalah dugaan
// berdasar format umum WAHA (id pesan biasanya menyertakan chat JID
// pengirimnya) — BELUM diverifikasi terhadap data produksi nyata (database
// dev di lingkungan ini tidak punya data yang sudah terlanjur kena bug).
// SELALU jalankan --dry-run dulu, baca daftar yang ketemu, pastikan memang
// itu status/story (bukan pesan customer asli) SEBELUM jalankan tanpa
// --dry-run.
//
// JANGAN hapus Conversation/Customer-nya — mereka customer ASLI, cuma
// pesan status yang salah masuk yang dihapus.
//
// Usage:
//   node scripts/cleanup-status-messages.js --dry-run   (WAJIB jalankan ini dulu)
//   node scripts/cleanup-status-messages.js             (eksekusi hapus + recalculate)

import { prisma } from "../src/db.js";
import { buildMessagePreview } from "../src/utils/messagePreview.js";

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  console.log("=== Cleanup pesan Status/Broadcast yang kadung masuk ===\n");
  if (!DRY_RUN) {
    console.log("⚠️  MODE EKSEKUSI SUNGGUHAN — pesan yang cocok akan DIHAPUS PERMANEN.\n");
  }

  const candidates = await prisma.message.findMany({
    where: {
      OR: [
        { externalId: { contains: "status@broadcast" } },
        { externalId: { contains: "status_broadcast" } },
        { externalId: { contains: "@broadcast" } },
      ],
    },
    include: {
      conversation: {
        select: {
          id: true, type: true,
          customer: { select: { id: true, name: true, phone: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  if (candidates.length === 0) {
    console.log("Tidak ada Message yang cocok pola status/broadcast. Tidak ada yang perlu dibersihkan.");
    return;
  }

  console.log(`Ditemukan ${candidates.length} pesan yang diduga berasal dari WhatsApp Status/broadcast:\n`);
  for (const m of candidates) {
    const conv = m.conversation;
    const custLabel = conv?.customer
      ? `${conv.customer.name || "(tanpa nama)"} (${conv.customer.phone})`
      : conv?.type === "GROUP" ? "(grup)" : "(tanpa customer)";
    const preview = (m.content || "").slice(0, 60).replace(/\n/g, " ");
    console.log(
      `- conv=${m.conversationId} customer=${custLabel} | ${m.direction} ${m.mediaType || "text"} ` +
      `preview="${preview}" waktu=${m.createdAt.toISOString()} externalId=${m.externalId}`
    );
  }

  if (DRY_RUN) {
    console.log(`\n[DRY RUN] ${candidates.length} pesan AKAN dihapus kalau dijalankan tanpa --dry-run.`);
    console.log("Periksa daftar di atas dulu — pastikan ini memang status/story, bukan pesan customer asli.");
    return;
  }

  // Kumpulkan conversation terdampak SEBELUM hapus, supaya bisa recalculate
  // lastMessageAt/lastMessagePreview/unreadCount dari message yang TERSISA
  // setelah penghapusan — JANGAN hapus Conversation/Customer-nya.
  const affectedConvIds = [...new Set(candidates.map((m) => m.conversationId))];
  const idsToDelete = candidates.map((m) => m.id);

  const result = await prisma.message.deleteMany({ where: { id: { in: idsToDelete } } });
  console.log(`\nDihapus ${result.count} pesan status/broadcast.`);

  console.log(`\nRecalculate ${affectedConvIds.length} percakapan terdampak...`);
  for (const convId of affectedConvIds) {
    const conv = await prisma.conversation.findUnique({
      where: { id: convId },
      select: { readAt: true, createdAt: true },
    });
    if (!conv) continue; // seharusnya tidak mungkin, tapi jaga-jaga

    const lastMsg = await prisma.message.findFirst({
      where: { conversationId: convId },
      orderBy: { createdAt: "desc" },
      select: { content: true, mediaType: true, createdAt: true },
    });

    // unreadCount — heuristik SAMA dengan scripts/backfill-preview-unread.js:
    // hitung Message INBOUND (dari sisa yang TERSISA) yang createdAt lebih
    // baru dari kapan terakhir dibuka (readAt, fallback createdAt conversation).
    const unreadCount = await prisma.message.count({
      where: {
        conversationId: convId,
        direction: "INBOUND",
        createdAt: { gt: conv.readAt || conv.createdAt },
      },
    });

    await prisma.conversation.update({
      where: { id: convId },
      data: {
        lastMessageAt: lastMsg?.createdAt || conv.createdAt,
        lastMessagePreview: lastMsg ? buildMessagePreview(lastMsg.content, lastMsg.mediaType) : "",
        unreadCount,
        unread: unreadCount > 0,
      },
    });
  }

  console.log("\n=== SELESAI ===");
  console.log(`${result.count} pesan status/broadcast dihapus, ${affectedConvIds.length} percakapan di-recalculate.`);
  console.log("Conversation & Customer TIDAK dihapus — hanya pesan status yang salah masuk.");
}

main()
  .catch((e) => { console.error("Error:", e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
