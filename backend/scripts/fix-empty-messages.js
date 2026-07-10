// Script perbaikan: cari Message dengan bubble KOSONG (content null/'' DAN
// mediaUrl null) — akibat bug lama sync riwayat yang cuma baca msg.body
// tanpa parsing media/tipe pesan lain (lihat parseHistoryMessage.js untuk
// fix-nya di jalur sync baru; script ini reparasi data LAMA yang sudah
// terlanjur kosong).
//
// Strategi per Message kosong:
//   1. Ambil Conversation + Customer.phone (skip GROUP — belum didukung,
//      groupJid butuh alur re-fetch beda dari fetchChatHistory per-nomor).
//   2. Re-fetch riwayat chat itu dari WAHA (fetchChatHistory, paginasi
//      penuh, sessionId conversation kalau ada), cari pesan dengan
//      externalId yang sama, parse ulang pakai parseHistoryMessage.
//   3. Kalau ketemu & hasil parse punya content/media yang lebih baik →
//      update Message.
//   4. Kalau TIDAK ketemu di WAHA (chat mungkin sudah di-archive/dihapus)
//      → isi placeholder: pakai mediaType YANG SUDAH TERSIMPAN kalau ada
//      (mis. dulu mediaType='image' tapi bubble kosong → "[Foto]"), kalau
//      mediaType juga null sama sekali → "[Pesan tidak didukung]".
//
// JANGAN auto-run — WAJIB pakai --dry-run dulu:
//   docker compose exec backend node scripts/fix-empty-messages.js --dry-run
// Baru jalankan sungguhan setelah di-review:
//   docker compose exec backend node scripts/fix-empty-messages.js

import { prisma } from "../src/db.js";
import { fetchChatHistory } from "../src/services/wahaClient.js";
import { parseHistoryMessage, MEDIA_TYPE_PLACEHOLDER } from "../src/utils/parseHistoryMessage.js";

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  console.log(DRY_RUN ? "=== MODE DRY-RUN: tidak ada data yang diubah ===\n" : "=== MODE LIVE: pesan kosong akan diperbaiki ===\n");

  const emptyMessages = await prisma.message.findMany({
    where: {
      OR: [{ content: null }, { content: "" }],
      mediaUrl: null,
    },
    include: {
      conversation: {
        select: { id: true, type: true, sessionId: true, customer: { select: { phone: true } } },
      },
    },
  });

  if (emptyMessages.length === 0) {
    console.log("Tidak ada Message dengan bubble kosong. Tidak ada yang perlu diperbaiki.");
    await prisma.$disconnect();
    return;
  }

  console.log(`Ditemukan ${emptyMessages.length} Message dengan bubble kosong.\n`);

  // Group per conversation supaya fetchChatHistory dipanggil SEKALI per
  // chat (bukan per message) — jauh lebih hemat panggilan WAHA API.
  const byConversation = new Map();
  for (const msg of emptyMessages) {
    if (!byConversation.has(msg.conversationId)) byConversation.set(msg.conversationId, []);
    byConversation.get(msg.conversationId).push(msg);
  }

  let repaired = 0, placeholdered = 0, skippedGroup = 0, failed = 0;

  for (const [conversationId, msgs] of byConversation) {
    const conv = msgs[0].conversation;

    if (conv.type === "GROUP") {
      console.log(`  [SKIP] Conversation ${conversationId} (GROUP) — ${msgs.length} pesan kosong, belum didukung di script ini.`);
      skippedGroup += msgs.length;
      continue;
    }

    const phone = conv.customer?.phone;
    if (!phone) {
      console.log(`  [GAGAL] Conversation ${conversationId} — tidak ada nomor customer, tidak bisa re-fetch.`);
      failed += msgs.length;
      continue;
    }

    console.log(`  Conversation ${conversationId} (${phone}) — ${msgs.length} pesan kosong, re-fetch dari WAHA...`);
    let history = [];
    try {
      history = await fetchChatHistory(phone, conv.sessionId || undefined, { maxMessages: 1000 });
    } catch (e) {
      console.warn(`    Gagal fetch riwayat: ${e.message}`);
    }
    const byExternalId = new Map(history.map((m) => [m.id || m.key?.id, m]));

    for (const msg of msgs) {
      const rawMatch = msg.externalId ? byExternalId.get(msg.externalId) : null;

      if (rawMatch) {
        const parsed = parseHistoryMessage(rawMatch);
        console.log(`    [KETEMU] ${msg.externalId} → "${parsed.content}" (mediaType: ${parsed.mediaType || "-"})`);
        if (!DRY_RUN) {
          await prisma.message.update({
            where: { id: msg.id },
            data: { content: parsed.content, mediaType: parsed.mediaType, mediaUrl: parsed.mediaUrl },
          });
        }
        repaired++;
        continue;
      }

      // Tidak ketemu di WAHA — isi placeholder dari mediaType tersimpan kalau ada
      const placeholder = msg.mediaType && MEDIA_TYPE_PLACEHOLDER[msg.mediaType]
        ? MEDIA_TYPE_PLACEHOLDER[msg.mediaType]
        : "[Pesan tidak didukung]";
      console.log(`    [TIDAK KETEMU] ${msg.externalId || msg.id} → placeholder: "${placeholder}"`);
      if (!DRY_RUN) {
        await prisma.message.update({ where: { id: msg.id }, data: { content: placeholder } });
      }
      placeholdered++;
    }
  }

  console.log(`\n${DRY_RUN ? "[DRY-RUN] Akan " : ""}Selesai.`);
  console.log(`Diperbaiki dari WAHA : ${repaired}`);
  console.log(`Diisi placeholder    : ${placeholdered}`);
  console.log(`Dilewati (grup)      : ${skippedGroup}`);
  console.log(`Gagal (no phone)     : ${failed}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
