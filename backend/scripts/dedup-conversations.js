// Script dedup Conversation — perbaikan data lama akibat race condition
// (2 event webhook nyaris bersamaan, masing-masing create Conversation
// sebelum salah satunya sempat commit). Harus dijalankan SEBELUM migration
// partial unique index (lihat schema.prisma komentar di model Conversation)
// diterapkan — migration akan GAGAL kalau masih ada data duplikat.
//
// Kandidat duplikat:
//   - INDIVIDUAL: Customer yang punya >1 Conversation di channel yang sama
//   - GROUP: >1 Conversation dengan groupJid yang sama
//
// Survivor dipilih: paling banyak Message, tie-break sessionId terisi,
// tie-break berikutnya createdAt paling lama (conversation asli, bukan
// hasil race).
//
// Semua Message dari duplikat dipindah ke survivor (P2002 pada externalId
// yang kebetulan sama persis di kedua conversation → buang salinan
// duplikatnya, bukan crash). unreadCount digabung (dijumlah), lastMessageAt
// dipakai yang paling baru dari semua duplikat.
//
// JANGAN auto-run — WAJIB pakai --dry-run dulu:
//   docker compose exec backend node scripts/dedup-conversations.js --dry-run
// Baru jalankan sungguhan (WAJIB sebelum migration partial unique index):
//   docker compose exec backend node scripts/dedup-conversations.js

import { prisma } from "../src/db.js";

const DRY_RUN = process.argv.includes("--dry-run");

// Survivor: paling banyak message > sessionId terisi > createdAt paling lama
function pickSurvivor(convs) {
  return [...convs].sort((a, b) => {
    if (b._count.messages !== a._count.messages) return b._count.messages - a._count.messages;
    const aHasSession = a.sessionId ? 1 : 0;
    const bHasSession = b.sessionId ? 1 : 0;
    if (bHasSession !== aHasSession) return bHasSession - aHasSession;
    return new Date(a.createdAt) - new Date(b.createdAt);
  })[0];
}

async function mergeGroup(label, convs) {
  const survivor = pickSurvivor(convs);
  const duplicates = convs.filter((c) => c.id !== survivor.id);

  console.log(`  ${label} — ${convs.length} Conversation duplikat:`);
  for (const c of convs) {
    const marker = c.id === survivor.id ? " ← SURVIVOR" : "";
    console.log(`    - ${c.id} | sessionId: ${c.sessionId || "(null)"} | ${c._count.messages} message | status: ${c.status} | createdAt: ${c.createdAt.toISOString()}${marker}`);
  }

  const latestMessageAt = convs.reduce((max, c) => (c.lastMessageAt > max ? c.lastMessageAt : max), survivor.lastMessageAt);
  const totalUnreadCount = convs.reduce((sum, c) => sum + (c.unreadCount || 0), 0);

  if (!DRY_RUN) {
    let movedMessages = 0, droppedDuplicateMessages = 0;
    for (const dup of duplicates) {
      const msgs = await prisma.message.findMany({ where: { conversationId: dup.id }, select: { id: true } });
      for (const m of msgs) {
        try {
          await prisma.message.update({ where: { id: m.id }, data: { conversationId: survivor.id } });
          movedMessages++;
        } catch (e) {
          if (e.code === "P2002") {
            // externalId sama persis sudah ada di survivor — buang duplikatnya
            await prisma.message.delete({ where: { id: m.id } });
            droppedDuplicateMessages++;
          } else {
            throw e;
          }
        }
      }
      await prisma.conversation.delete({ where: { id: dup.id } });
    }
    await prisma.conversation.update({
      where: { id: survivor.id },
      data: { lastMessageAt: latestMessageAt, unreadCount: totalUnreadCount },
    });
    console.log(`    ✓ DI-MERGE — ${duplicates.length} duplikat dihapus, ${movedMessages} message dipindah, ${droppedDuplicateMessages} message duplikat dibuang, unreadCount digabung jadi ${totalUnreadCount}.\n`);
  } else {
    console.log(`    [DRY-RUN] Akan merge ${duplicates.map((d) => d.id).join(", ")} → ${survivor.id}, unreadCount gabungan: ${totalUnreadCount}, lastMessageAt: ${latestMessageAt.toISOString()}.\n`);
  }
}

async function dedupIndividual() {
  console.log("=== Dedup INDIVIDUAL (customerId + channel sama) ===\n");

  const convs = await prisma.conversation.findMany({
    where: { type: "INDIVIDUAL", customerId: { not: null } },
    include: { _count: { select: { messages: true } }, customer: { select: { phone: true, name: true } } },
  });

  const byKey = new Map(); // `${customerId}::${channel}` -> convs[]
  for (const c of convs) {
    const key = `${c.customerId}::${c.channel}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(c);
  }

  const dupGroups = [...byKey.entries()].filter(([, list]) => list.length > 1);
  if (dupGroups.length === 0) {
    console.log("Tidak ada Customer dengan Conversation duplikat.\n");
    return 0;
  }

  for (const [, list] of dupGroups) {
    const cust = list[0].customer;
    await mergeGroup(`Customer ${list[0].customerId} (${cust?.name || cust?.phone || "?"}) — channel ${list[0].channel}`, list);
  }
  return dupGroups.length;
}

async function dedupGroups() {
  console.log("=== Dedup GROUP (groupJid sama) ===\n");

  const convs = await prisma.conversation.findMany({
    where: { type: "GROUP", groupJid: { not: null } },
    include: { _count: { select: { messages: true } } },
  });

  const byJid = new Map();
  for (const c of convs) {
    if (!byJid.has(c.groupJid)) byJid.set(c.groupJid, []);
    byJid.get(c.groupJid).push(c);
  }

  const dupGroups = [...byJid.entries()].filter(([, list]) => list.length > 1);
  if (dupGroups.length === 0) {
    console.log("Tidak ada groupJid duplikat.\n");
    return 0;
  }

  for (const [groupJid, list] of dupGroups) {
    await mergeGroup(groupJid, list);
  }
  return dupGroups.length;
}

async function main() {
  console.log(DRY_RUN ? "=== MODE DRY-RUN: tidak ada data yang diubah ===\n" : "=== MODE LIVE: duplikat akan di-merge ===\n");

  const individualMerged = await dedupIndividual();
  const groupMerged = await dedupGroups();

  console.log(`${DRY_RUN ? "[DRY-RUN] Akan " : ""}Total di-merge: ${individualMerged} customer + ${groupMerged} grup.`);
  if (DRY_RUN) {
    console.log("\nJalankan tanpa --dry-run untuk terapkan, WAJIB sebelum migration partial unique index dijalankan (lihat schema.prisma).");
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
