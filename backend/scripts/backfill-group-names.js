// Script SATU-PINTU untuk urusan grup WA (Task 4): reklasifikasi Customer
// yang sebenarnya grup (gabungan logika scripts/fix-group-conversations.js)
// + backfill Conversation.groupName dari WAHA (authoritative source, bukan
// tebak dari payload webhook lama / data migrasi historis yang salah).
//
// FASE 1 — Reklasifikasi (gabungan fix-group-conversations.js):
//   Kandidat "Customer yang sebenarnya grup":
//     - phone mengandung "@g.us" (JID grup tersimpan salah di field phone)
//     - phone ada tapi TIDAK cocok format HP Indonesia (62xxxxxxxxxx)
//     - phone null DAN nama mengandung kata kunci grup (GRUP/TIM/SALES/dst)
//   Customer dengan order/catatan di-SKIP otomatis (kemungkinan customer
//   asli dengan nomor tidak standar, bukan grup) — perlu review manual.
//   Conversation-nya diubah type=GROUP + groupJid + customerId=null,
//   Customer palsu dihapus (kalau tidak ada order/catatan).
//
// FASE 2 — Backfill nama grup:
//   Untuk SETIAP Conversation type=GROUP (termasuk hasil reklasifikasi
//   Fase 1), tanya WAHA langsung (GET /api/{session}/groups/{groupJid},
//   lihat wahaClient.js#getGroupInfo). Bandingkan dengan groupName
//   tersimpan; kalau beda (atau null), update + catat di mapping.
//
// session dipakai per-conversation dari conversation.sessionId (kalau ada)
// supaya query ke WAHA session yang benar (CS-1/CS-2) — kalau sessionId
// null, fallback ke WAHA_SESSION env default.
//
// Setelah update: perubahan langsung ke DB (bukan lewat live socket event,
// script ini proses terpisah dari server backend yang sedang jalan) — user
// perlu refresh halaman Inbox sekali untuk lihat nama baru. Kalau server
// backend sedang jalan, restart TIDAK PERLU (bukan perubahan skema/kode).
//
// JANGAN auto-run — WAJIB pakai --dry-run dulu untuk preview:
//   docker compose exec backend node scripts/backfill-group-names.js --dry-run
// Baru jalankan sungguhan setelah di-review:
//   docker compose exec backend node scripts/backfill-group-names.js

import { prisma } from "../src/db.js";
import { getGroupInfo } from "../src/services/wahaClient.js";

const DRY_RUN = process.argv.includes("--dry-run");

const VALID_PHONE_REGEX = /^62\d{8,12}$/;
const GROUP_NAME_KEYWORDS = [
  "GRUP", "GROUP", "TIM", "TEAM",
  "PRODUKSI", "DRIVETHRU", "DRIVE THRU",
  "SALES", "MARKETING", "ADMIN", "INTERNAL",
];

function looksLikeGroupName(name) {
  if (!name) return false;
  const upper = name.toUpperCase();
  return GROUP_NAME_KEYWORDS.some((kw) => upper.includes(kw));
}

function isMisclassifiedGroupCustomer(c) {
  if (c.phone && c.phone.includes("@g.us")) return true; // JID grup ke-simpan salah di field phone
  if (c.phone !== null && c.phone !== undefined) return !VALID_PHONE_REGEX.test(c.phone);
  return looksLikeGroupName(c.name); // phone null, cuma flag kalau nama terlihat grup
}

async function reclassifyMisclassifiedGroups() {
  console.log("=== FASE 1 — Reklasifikasi Customer yang sebenarnya grup ===\n");

  const allCustomers = await prisma.customer.findMany({
    include: {
      conversations: true,
      orders: { take: 1 },
      notes:  { take: 1 },
    },
  });

  const candidates = allCustomers.filter(isMisclassifiedGroupCustomer);

  if (candidates.length === 0) {
    console.log("Tidak ditemukan Customer yang salah klasifikasi sebagai grup.\n");
    return { reclassified: 0, skipped: 0 };
  }

  console.log(`Ditemukan ${candidates.length} Customer mencurigakan (kemungkinan sebenarnya grup):\n`);

  let reclassified = 0, skipped = 0;

  for (const c of candidates) {
    const hasOrders = c.orders.length > 0;
    const hasNotes  = c.notes.length > 0;

    let groupJid;
    if (c.phone?.includes("@g.us")) groupJid = c.phone;
    else if (c.phone) groupJid = `${c.phone}@g.us`;
    else groupJid = `unknown-${c.id}@g.us`;

    const groupNameGuess = c.name || groupJid.split("@")[0];

    console.log(`  Customer: ${c.id} | phone: ${c.phone ?? "(null)"} | name: ${c.name || "-"}`);
    console.log(`    groupJid: ${groupJid}`);
    console.log(`    orders: ${c.orders.length} | notes: ${c.notes.length} | convs: ${c.conversations.length}`);

    if (hasOrders || hasNotes) {
      console.log(`    ⚠ SKIP — ada order/catatan, kemungkinan customer asli dengan nomor tidak standar. Periksa manual.\n`);
      skipped++;
      continue;
    }

    if (!DRY_RUN) {
      for (const conv of c.conversations) {
        await prisma.conversation.update({
          where: { id: conv.id },
          data:  { type: "GROUP", groupJid, groupName: groupNameGuess, customerId: null },
        });
      }
      await prisma.customer.delete({ where: { id: c.id } });
      console.log(`    ✓ DIREKLASIFIKASI — ${c.conversations.length} conversation → GROUP, customer palsu dihapus.\n`);
    } else {
      console.log(`    [DRY-RUN] Akan direklasifikasi: ${c.conversations.length} conv → GROUP, customer akan dihapus.\n`);
    }
    reclassified++;
  }

  console.log(`Fase 1 selesai. ${DRY_RUN ? "[DRY-RUN] Akan " : ""}Direklasifikasi: ${reclassified} | Dilewati (perlu review manual): ${skipped}\n`);
  return { reclassified, skipped };
}

async function backfillGroupNames() {
  console.log("=== FASE 2 — Backfill nama grup dari WAHA ===\n");

  const groups = await prisma.conversation.findMany({
    where: { type: "GROUP" },
    select: { id: true, groupJid: true, groupName: true, sessionId: true },
  });

  if (groups.length === 0) {
    console.log("Tidak ada Conversation type=GROUP. Tidak ada yang perlu diproses.\n");
    return { mapping: [], unchanged: 0, failed: 0 };
  }

  console.log(`Ditemukan ${groups.length} percakapan grup.\n`);

  const mapping = []; // { groupJid, before, after }
  let unchanged = 0, failed = 0;

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
    mapping.push({ groupJid: conv.groupJid, before: conv.groupName || "(null)", after: freshName });
  }

  console.log(`\nFase 2 selesai. ${DRY_RUN ? "[DRY-RUN] Akan " : ""}Diupdate: ${mapping.length} | Sudah benar: ${unchanged} | Gagal/skip: ${failed}`);
  return { mapping, unchanged, failed };
}

async function main() {
  console.log(DRY_RUN ? "=== MODE DRY-RUN: TIDAK ADA data yang diubah ===\n" : "=== MODE LIVE: data AKAN diubah ===\n");

  await reclassifyMisclassifiedGroups();
  const { mapping, unchanged, failed } = await backfillGroupNames();

  if (mapping.length > 0) {
    console.log("\n=== Mapping nama grup: LAMA → BARU ===");
    for (const m of mapping) {
      console.log(`  ${m.groupJid}`);
      console.log(`    "${m.before}" → "${m.after}"`);
    }
  }

  if (failed > 0) {
    console.log("\n⚠ Ada grup yang gagal diproses — kemungkinan WAHA API groups endpoint tidak tersedia di versi ini, atau session salah. Cek manual.");
  }

  console.log(
    DRY_RUN
      ? "\n[DRY-RUN selesai] Jalankan tanpa --dry-run setelah hasil di atas di-review untuk terapkan perubahan."
      : "\nSelesai. Refresh halaman Inbox di browser untuk lihat nama grup terbaru (perubahan ini ke DB langsung, bukan lewat socket live — server backend tidak perlu di-restart)."
  );

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
