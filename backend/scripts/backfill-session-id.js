// Script backfill: tentukan Conversation.sessionId untuk history lama yang
// masih NULL (Task 5). sessionId dipakai Fase F+ untuk memastikan balasan
// keluar lewat nomor WA (CS-1/CS-2) yang benar — lihat conversations.js
// resolveSendSession(). Conversation lama (sebelum field ini ada, atau
// dibuat lewat sync-history yang tidak lewat webhook) masih null.
//
// Strategi (urutan prioritas):
//   1. Metadata pesan — DIHONEST-KAN DI SINI: Message model TIDAK punya
//      field session sendiri (cek prisma/schema.prisma), jadi tidak ada
//      metadata pesan yang bisa dipakai. Langkah ini selalu skip ke (2).
//   2. Cek WAHA langsung: ambil daftar chat dari CS-1 dan CS-2 (GET
//      /api/{session}/chats), cocokkan berdasarkan nomor customer (untuk
//      INDIVIDUAL) atau groupJid (untuk GROUP).
//        - Ketemu di CS-1 saja  → sessionId = "CS-1"
//        - Ketemu di CS-2 saja  → sessionId = "CS-2"
//        - Ketemu di KEDUANYA   → AMBIGU — pilih yang conversationTimestamp
//          lebih baru (chat lebih aktif di sesi itu), log warning eksplisit
//          supaya bisa direview manual kalau perlu.
//        - Tidak ketemu di keduanya → tidak diubah, dicatat sebagai
//          "tidak ketemu" (kemungkinan chat sudah tidak aktif/di-archive
//          di WAHA, atau history dari sebelum WAHA connect).
//
// JANGAN auto-run — WAJIB pakai --dry-run dulu:
//   docker compose exec backend node scripts/backfill-session-id.js --dry-run
// Baru jalankan sungguhan setelah hasil di-review:
//   docker compose exec backend node scripts/backfill-session-id.js

import { prisma } from "../src/db.js";
import { getChats, normalizePhoneNumber } from "../src/services/wahaClient.js";

const DRY_RUN = process.argv.includes("--dry-run");
const SESSIONS = ["CS-1", "CS-2"];
const CHATS_LIMIT = 500; // ambil cukup banyak chat per sesi supaya coverage tinggi

// Bangun index { key -> timestamp } dari daftar chat 1 session. key = nomor
// customer (INDIVIDUAL) atau groupJid mentah (GROUP, chat.id sudah "@g.us").
async function buildChatIndex(session) {
  const chats = await getChats(CHATS_LIMIT, session);
  const index = new Map();
  for (const chat of chats) {
    const rawId = chat.id || "";
    const timestamp = chat.conversationTimestamp ?? chat.timestamp ?? 0;
    if (!rawId) continue;
    if (rawId.endsWith("@g.us")) {
      index.set(rawId, timestamp);
    } else {
      const phone = await normalizePhoneNumber(rawId, session);
      if (phone) index.set(phone, timestamp);
    }
  }
  return index;
}

async function main() {
  console.log(DRY_RUN ? "=== MODE DRY-RUN: tidak ada data yang diubah ===\n" : "=== MODE LIVE: sessionId akan diupdate ===\n");

  const conversations = await prisma.conversation.findMany({
    where: { sessionId: null },
    include: { customer: { select: { phone: true } } },
  });

  if (conversations.length === 0) {
    console.log("Tidak ada Conversation dengan sessionId null. Tidak ada yang perlu diproses.");
    await prisma.$disconnect();
    return;
  }

  console.log(`Ditemukan ${conversations.length} Conversation dengan sessionId null.`);
  console.log("Metadata pesan: Message model tidak punya field session sendiri — langsung cek WAHA.\n");
  console.log("Mengambil daftar chat dari CS-1 dan CS-2...\n");

  const indexBySession = {};
  for (const session of SESSIONS) {
    indexBySession[session] = await buildChatIndex(session);
    console.log(`  ${session}: ${indexBySession[session].size} chat ditemukan di WAHA`);
  }
  console.log("");

  let cs1Count = 0, cs2Count = 0, ambiguousCount = 0, notFoundCount = 0;

  for (const conv of conversations) {
    const key = conv.type === "GROUP" ? conv.groupJid : conv.customer?.phone;
    if (!key) {
      console.log(`  [TIDAK KETEMU] Conversation ${conv.id} — tidak ada nomor/groupJid untuk dicocokkan.`);
      notFoundCount++;
      continue;
    }

    const tsCs1 = indexBySession["CS-1"].get(key);
    const tsCs2 = indexBySession["CS-2"].get(key);
    const inCs1 = tsCs1 !== undefined;
    const inCs2 = tsCs2 !== undefined;

    let chosenSession = null;
    if (inCs1 && inCs2) {
      chosenSession = tsCs1 >= tsCs2 ? "CS-1" : "CS-2";
      console.warn(`  [AMBIGU] ${key} ada di CS-1 DAN CS-2 — pilih ${chosenSession} (pesan lebih baru). Review manual disarankan.`);
      ambiguousCount++;
    } else if (inCs1) {
      chosenSession = "CS-1";
      cs1Count++;
    } else if (inCs2) {
      chosenSession = "CS-2";
      cs2Count++;
    } else {
      console.log(`  [TIDAK KETEMU] ${key} — tidak ada di CS-1 maupun CS-2 (chat mungkin sudah tidak aktif di WAHA).`);
      notFoundCount++;
      continue;
    }

    console.log(`  ${key} → ${chosenSession}`);
    if (!DRY_RUN) {
      await prisma.conversation.update({
        where: { id: conv.id },
        data:  { sessionId: chosenSession },
      });
    }
  }

  console.log("\n=== Ringkasan ===");
  console.log(`Total diproses : ${conversations.length}`);
  console.log(`CS-1           : ${cs1Count}`);
  console.log(`CS-2           : ${cs2Count}`);
  console.log(`Ambigu         : ${ambiguousCount} (ikut ke salah satu CS-1/CS-2 di atas, dipilih dari pesan terbaru)`);
  console.log(`Tidak ketemu   : ${notFoundCount} (tidak diubah)`);

  console.log(
    DRY_RUN
      ? "\n[DRY-RUN selesai] Jalankan tanpa --dry-run setelah hasil di atas di-review."
      : "\nSelesai."
  );

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
