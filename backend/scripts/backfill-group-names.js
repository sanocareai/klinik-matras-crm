// Script backfill: perbaiki Conversation.groupName untuk SEMUA percakapan
// type=GROUP yang null ATAU salah (misal masih nama member/pushName
// pengirim tersisa dari sebelum deteksi grup ada, lihat scripts/
// fix-group-conversations.js — migrasi lama itu sempat isi groupName dari
// Customer.name, yang di beberapa kasus sebenarnya pushName pengirim, bukan
// subject grup yang sesungguhnya).
//
// Strategi: untuk SETIAP Conversation type=GROUP, tanya WAHA langsung
// (GET /api/{session}/groups/{groupJid}, lihat wahaClient.js#getGroupInfo)
// — sumber otoritatif, bukan tebak dari payload webhook lama. Bandingkan
// dengan groupName yang tersimpan sekarang; kalau beda (atau null), catat
// sebagai perubahan yang akan dilakukan.
//
// session dipakai per-conversation dari conversation.sessionId (kalau ada)
// supaya query ke WAHA session yang benar (CS-1/CS-2) — kalau sessionId
// juga null, fallback ke WAHA_SESSION env default (kemungkinan gagal kalau
// grup itu sebenarnya ada di session lain, akan ter-log sebagai skip).
//
// JANGAN auto-run — WAJIB pakai --dry-run dulu untuk preview:
//   docker compose exec backend node scripts/backfill-group-names.js --dry-run
// Baru jalankan sungguhan setelah di-review:
//   docker compose exec backend node scripts/backfill-group-names.js

import { prisma } from "../src/db.js";
import { getGroupInfo } from "../src/services/wahaClient.js";

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  console.log(DRY_RUN ? "=== MODE DRY-RUN: tidak ada data yang diubah ===\n" : "=== MODE LIVE: groupName akan diupdate ===\n");

  const groups = await prisma.conversation.findMany({
    where: { type: "GROUP" },
    select: { id: true, groupJid: true, groupName: true, sessionId: true },
  });

  if (groups.length === 0) {
    console.log("Tidak ada Conversation type=GROUP. Tidak ada yang perlu diproses.");
    await prisma.$disconnect();
    return;
  }

  console.log(`Ditemukan ${groups.length} percakapan grup.\n`);

  let updated = 0, unchanged = 0, failed = 0;

  for (const conv of groups) {
    if (!conv.groupJid) {
      console.log(`  [SKIP] Conversation ${conv.id} — groupJid kosong, tidak bisa query WAHA.`);
      failed++;
      continue;
    }

    const freshName = await getGroupInfo(conv.groupJid, conv.sessionId || undefined);

    if (!freshName) {
      console.log(`  [GAGAL] ${conv.groupJid} — WAHA tidak kembalikan nama (session: ${conv.sessionId || "(default)"}). groupName lama: "${conv.groupName || "(null)"}" — tidak diubah.`);
      failed++;
      continue;
    }

    if (freshName === conv.groupName) {
      console.log(`  [OK] ${conv.groupJid} — groupName sudah benar: "${freshName}"`);
      unchanged++;
      continue;
    }

    console.log(`  [BEDA] ${conv.groupJid} — lama: "${conv.groupName || "(null)"}" → baru: "${freshName}"`);
    if (!DRY_RUN) {
      await prisma.conversation.update({
        where: { id: conv.id },
        data:  { groupName: freshName },
      });
      console.log(`         ✓ Diupdate.`);
    } else {
      console.log(`         [DRY-RUN] Akan diupdate.`);
    }
    updated++;
  }

  console.log(`\nSelesai. ${DRY_RUN ? "[DRY-RUN] Akan " : ""}Diupdate: ${updated} | Sudah benar: ${unchanged} | Gagal/skip: ${failed}`);
  if (failed > 0) {
    console.log("⚠ Grup yang gagal perlu dicek manual — kemungkinan WAHA API groups endpoint tidak tersedia di versi ini, atau session salah.");
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
