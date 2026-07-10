// Script perbaikan: cari Message dengan bubble KOSONG (content null/'' DAN
// mediaUrl null) — akibat bug lama webhook/sync yang tidak parsing media
// grup & individual (lihat webhooks.js Fix 1 utk perbaikan jalur baru;
// script ini reparasi data LAMA yang sudah terlanjur kosong, termasuk grup
// — mayoritas bubble kosong produksi ada di grup, mis. SANO TIM PRODUKSI
// 61 dari 94 pesan adalah media yang sebelumnya tidak pernah di-parse).
//
// Strategi per Message kosong:
//   1. Ambil Conversation — INDIVIDUAL pakai Customer.phone, GROUP pakai
//      groupJid langsung (fetchChatHistory terima keduanya, lihat
//      wahaClient.js).
//   2. Re-fetch riwayat chat itu dari WAHA (fetchChatHistory, paginasi
//      penuh + downloadMedia=true sejak Fix 2, sessionId conversation
//      kalau ada), cari pesan dengan externalId yang sama, parse ulang
//      pakai parseHistoryMessage (shared parser, sama dgn webhooks.js).
//   3. Kalau ketemu DAN dapat mediaUrl sungguhan → "diperbaiki-dengan-media".
//   4. Kalau ketemu tapi TETAP tidak ada mediaUrl (WAHA gagal decrypt/media
//      sudah kedaluwarsa di server WA) → isi placeholder sesuai tipe →
//      "placeholder-saja".
//   5. Kalau TIDAK ketemu di WAHA sama sekali (chat/pesan sudah di-archive
//      atau dihapus) → pakai mediaType YANG SUDAH TERSIMPAN kalau ada
//      (placeholder sesuai itu), atau "[Media]" generik kalau mediaType
//      juga null sama sekali → "gagal".
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
      content: "", // Message.content bukan nullable (@default("")), jadi kosong = string ""
      mediaUrl: null,
    },
    include: {
      conversation: {
        select: { id: true, type: true, sessionId: true, groupJid: true, customer: { select: { phone: true } } },
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

  let repairedWithMedia = 0, placeholderOnly = 0, failed = 0;

  for (const [conversationId, msgs] of byConversation) {
    const conv = msgs[0].conversation;

    // INDIVIDUAL pakai nomor customer, GROUP pakai groupJid langsung —
    // fetchChatHistory terima keduanya (deteksi otomatis via "@" di string).
    const identity = conv.type === "GROUP" ? conv.groupJid : conv.customer?.phone;
    if (!identity) {
      console.log(`  [GAGAL] Conversation ${conversationId} (${conv.type}) — tidak ada identitas (phone/groupJid), tidak bisa re-fetch.`);
      failed += msgs.length;
      continue;
    }

    console.log(`  Conversation ${conversationId} (${conv.type}, ${identity}) — ${msgs.length} pesan kosong, re-fetch dari WAHA...`);
    let history = [];
    try {
      history = await fetchChatHistory(identity, conv.sessionId || undefined, { maxMessages: 1000 });
    } catch (e) {
      console.warn(`    Gagal fetch riwayat: ${e.message}`);
    }
    const byExternalId = new Map(history.map((m) => [m.id || m.key?.id, m]));

    for (const msg of msgs) {
      const rawMatch = msg.externalId ? byExternalId.get(msg.externalId) : null;

      if (rawMatch) {
        const parsed = parseHistoryMessage(rawMatch);
        if (!DRY_RUN) {
          await prisma.message.update({
            where: { id: msg.id },
            data: { content: parsed.content, mediaType: parsed.mediaType, mediaUrl: parsed.mediaUrl },
          });
        }
        if (parsed.mediaUrl) {
          console.log(`    [DIPERBAIKI+MEDIA] ${msg.externalId} → "${parsed.content}" (${parsed.mediaType}, url tersimpan)`);
          repairedWithMedia++;
        } else {
          console.log(`    [PLACEHOLDER] ${msg.externalId} → "${parsed.content}" (mediaType: ${parsed.mediaType || "-"}, WAHA tidak kasih URL media)`);
          placeholderOnly++;
        }
        continue;
      }

      // Tidak ketemu di WAHA — isi placeholder dari mediaType tersimpan kalau ada
      const placeholder = msg.mediaType && MEDIA_TYPE_PLACEHOLDER[msg.mediaType]
        ? MEDIA_TYPE_PLACEHOLDER[msg.mediaType]
        : "[Media]";
      console.log(`    [GAGAL — tidak ketemu di WAHA] ${msg.externalId || msg.id} → placeholder: "${placeholder}"`);
      if (!DRY_RUN) {
        await prisma.message.update({ where: { id: msg.id }, data: { content: placeholder } });
      }
      failed++;
    }
  }

  console.log(`\n${DRY_RUN ? "[DRY-RUN] Akan " : ""}Selesai.`);
  console.log(`Diperbaiki dengan media (URL tersimpan) : ${repairedWithMedia}`);
  console.log(`Placeholder saja (ketemu, tanpa URL)     : ${placeholderOnly}`);
  console.log(`Gagal (tidak ketemu di WAHA)             : ${failed}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
