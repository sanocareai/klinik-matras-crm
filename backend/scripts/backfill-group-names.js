// Script SATU-PINTU untuk urusan grup WA (Task 4, diperbaiki lebih lanjut
// setelah temuan dry-run produksi): reklasifikasi Customer yang sebenarnya
// grup (gabungan logika scripts/fix-group-conversations.js) + backfill
// Conversation.groupName dari WAHA (authoritative source).
//
// FASE 0 — Bersihkan status@g.us (WhatsApp Status/broadcast, BUKAN grup
//   sungguhan): hapus Conversation + Message yang nyasar ke sini.
//
// FASE 1 — Reklasifikasi (gabungan fix-group-conversations.js):
//   Kandidat "AUTO" (confidence tinggi, direklasifikasi otomatis):
//     - phone mengandung "@g.us" (JID grup tersimpan salah di field phone)
//     - phone null DAN nama mengandung kata kunci grup (GRUP/TIM/SALES/dst)
//   Kandidat "MANUAL" (TIDAK di-auto — cuma ditampilkan utk review):
//     - phone terlihat seperti nomor internasional valid (mis. +44 UK) atau
//       pola tidak dikenali sama sekali — nomor asing BUKAN otomatis grup.
//   Customer AUTO dengan order/catatan tetap di-SKIP (kemungkinan customer
//   asli nomor tidak standar).
//
// FASE 1.5 — Dedup groupJid yang sama (>1 Conversation, mis. satu
//   sessionId null dari data lama + satu lagi CS-2 dari webhook baru):
//   merge Message ke survivor (prioritas sessionId terisi, lalu message
//   terbanyak), hapus duplikatnya.
//
// FASE 2 — Backfill nama grup: untuk SETIAP Conversation type=GROUP, tanya
//   WAHA (GET /api/{session}/groups/{groupJid}, wahaClient.js#getGroupInfo
//   — parsing field "Name" PascalCase, format asli WAHA GOWS). Session
//   dicoba BERURUTAN (session tersimpan dulu kalau ada, lalu CS-1, CS-2)
//   sampai salah satu berhasil — sessionId di-SELF-HEAL ke session yang
//   terbukti berhasil itu, bukan cuma dipakai sekali pakai.
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

const SESSIONS = ["CS-1", "CS-2"];
const STATUS_BROADCAST_JID = "status@g.us"; // WhatsApp Status/broadcast — BUKAN grup sungguhan

const VALID_PHONE_REGEX = /^62\d{8,12}$/;       // format HP Indonesia
const INTL_PHONE_REGEX  = /^\d{7,15}$/;         // pola nomor internasional umum (tanpa @g.us) — mis. +44 UK
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

// Klasifikasi Customer yang mungkin sebenarnya grup:
//   "AUTO"   — confidence tinggi, aman direklasifikasi otomatis (tetap kena
//              guard order/catatan di reclassifyMisclassifiedGroups)
//   "MANUAL" — phone terlihat seperti nomor internasional valid (mis. +44 UK
//              "Grandong" 447529317574) ATAU pola tidak dikenali sama sekali
//              — JANGAN auto-reklasifikasi, cuma ditampilkan utk review manual
//   "SKIP"   — bukan kandidat sama sekali (phone format Indonesia valid,
//              atau phone null tanpa nama yang terlihat seperti grup)
function classifyCustomer(c) {
  if (c.phone?.includes("@g.us")) return "AUTO"; // JID grup ke-simpan salah di field phone
  if (c.phone === null || c.phone === undefined) {
    return looksLikeGroupName(c.name) ? "AUTO" : "SKIP";
  }
  if (VALID_PHONE_REGEX.test(c.phone)) return "SKIP"; // format HP Indonesia valid — customer asli
  if (INTL_PHONE_REGEX.test(c.phone)) return "MANUAL"; // nomor internasional yang PLAUSIBEL valid — jangan auto
  return "MANUAL"; // pola tidak dikenali — aman, review manual daripada auto
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

  const autoCandidates   = [];
  const manualCandidates = [];
  for (const c of allCustomers) {
    const cls = classifyCustomer(c);
    if (cls === "AUTO") autoCandidates.push(c);
    else if (cls === "MANUAL") manualCandidates.push(c);
  }

  if (manualCandidates.length > 0) {
    console.log(`⚠⚠⚠ ${manualCandidates.length} Customer PERLU REVIEW MANUAL (nomor terlihat internasional valid atau pola tidak dikenali — TIDAK di-auto-reklasifikasi):\n`);
    for (const c of manualCandidates) {
      console.log(`  ⚠ Customer: ${c.id} | phone: ${c.phone} | name: ${c.name || "-"} | convs: ${c.conversations.length}`);
    }
    console.log("");
  }

  if (autoCandidates.length === 0) {
    console.log("Tidak ada Customer dengan confidence tinggi untuk direklasifikasi otomatis.\n");
    return { reclassified: 0, skipped: 0, manualReview: manualCandidates.length };
  }

  console.log(`Ditemukan ${autoCandidates.length} Customer confidence TINGGI (kemungkinan besar sebenarnya grup):\n`);

  let reclassified = 0, skipped = 0;

  for (const c of autoCandidates) {
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

  console.log(`Fase 1 selesai. ${DRY_RUN ? "[DRY-RUN] Akan " : ""}Direklasifikasi: ${reclassified} | Dilewati (perlu review manual): ${skipped} | Perlu review manual (nomor internasional/pola asing): ${manualCandidates.length}\n`);
  return { reclassified, skipped, manualReview: manualCandidates.length };
}

// FASE 0 — status@g.us adalah WhatsApp Status/broadcast, BUKAN grup
// sungguhan. Kalau ada Conversation nyasar tersimpan dengan groupJid ini
// (atau Customer.phone-nya, kasus data lama sebelum ada gate ini), hapus
// beserta Message-nya (bukan grup asli, tidak ada nilai historisnya).
async function cleanupStatusBroadcast() {
  console.log("=== FASE 0 — Bersihkan status@g.us (WhatsApp Status, bukan grup) ===\n");

  const badConversations = await prisma.conversation.findMany({
    where: {
      OR: [
        { groupJid: STATUS_BROADCAST_JID },
        { customer: { phone: STATUS_BROADCAST_JID } },
      ],
    },
    include: { customer: true, _count: { select: { messages: true } } },
  });

  if (badConversations.length === 0) {
    console.log("Tidak ada Conversation status@g.us. Tidak ada yang perlu dibersihkan.\n");
    return { removed: 0, messagesRemoved: 0 };
  }

  let messagesRemoved = 0;
  for (const conv of badConversations) {
    console.log(`  Conversation: ${conv.id} | type: ${conv.type} | groupJid: ${conv.groupJid || "-"} | customer.phone: ${conv.customer?.phone || "-"} | nama: ${conv.groupName || conv.customer?.name || "-"}`);
    console.log(`    ${conv._count.messages} message akan ikut terhapus.`);
    messagesRemoved += conv._count.messages;

    if (!DRY_RUN) {
      await prisma.message.deleteMany({ where: { conversationId: conv.id } });
      await prisma.conversation.delete({ where: { id: conv.id } });
      if (conv.customer && conv.customer.phone === STATUS_BROADCAST_JID) {
        await prisma.customer.delete({ where: { id: conv.customer.id } }).catch(() => {});
      }
      console.log(`    ✓ DIHAPUS.\n`);
    } else {
      console.log(`    [DRY-RUN] Akan dihapus (conversation + ${conv._count.messages} message).\n`);
    }
  }

  console.log(`Fase 0 selesai. ${DRY_RUN ? "[DRY-RUN] Akan " : ""}Dihapus: ${badConversations.length} conversation, ${messagesRemoved} message.\n`);
  return { removed: badConversations.length, messagesRemoved };
}

// FASE 1.5 — dedup Conversation dengan groupJid yang SAMA (mis. satu dengan
// sessionId null/kena data lama, satu lagi CS-2 dari webhook baru). Survivor
// dipilih: prioritas yang PUNYA sessionId, lalu yang message-nya paling
// banyak. Semua Message dari conversation duplikat dipindah ke survivor,
// duplikatnya dihapus.
async function dedupDuplicateGroups() {
  console.log("=== FASE 1.5 — Dedup grup dengan groupJid sama ===\n");

  const groups = await prisma.conversation.findMany({
    where: { type: "GROUP", groupJid: { not: null } },
    include: { _count: { select: { messages: true } } },
  });

  const byJid = new Map();
  for (const conv of groups) {
    if (!byJid.has(conv.groupJid)) byJid.set(conv.groupJid, []);
    byJid.get(conv.groupJid).push(conv);
  }

  const duplicateGroups = [...byJid.entries()].filter(([, convs]) => convs.length > 1);

  if (duplicateGroups.length === 0) {
    console.log("Tidak ada groupJid duplikat. Tidak ada yang perlu di-dedup.\n");
    return { merged: 0 };
  }

  let merged = 0;

  for (const [groupJid, convs] of duplicateGroups) {
    console.log(`  ${groupJid} — ${convs.length} Conversation duplikat:`);
    for (const c of convs) {
      console.log(`    - ${c.id} | sessionId: ${c.sessionId || "(null)"} | ${c._count.messages} message | groupName: "${c.groupName || "(null)"}"`);
    }

    // Survivor: prioritas sessionId terisi, lalu message terbanyak.
    const withSession = convs.filter((c) => c.sessionId);
    const pool = withSession.length > 0 ? withSession : convs;
    const survivor = pool.reduce((best, c) => (c._count.messages > best._count.messages ? c : best), pool[0]);
    const duplicates = convs.filter((c) => c.id !== survivor.id);

    console.log(`    → Survivor: ${survivor.id} (sessionId: ${survivor.sessionId || "(null)"}, ${survivor._count.messages} message)`);

    if (!DRY_RUN) {
      for (const dup of duplicates) {
        const msgs = await prisma.message.findMany({ where: { conversationId: dup.id }, select: { id: true } });
        for (const m of msgs) {
          try {
            await prisma.message.update({ where: { id: m.id }, data: { conversationId: survivor.id } });
          } catch (e) {
            if (e.code === "P2002") {
              // externalId sudah ada di survivor (pesan sama tersimpan dobel di 2 conversation) — buang duplikatnya
              await prisma.message.delete({ where: { id: m.id } });
            } else {
              throw e;
            }
          }
        }
        await prisma.conversation.delete({ where: { id: dup.id } });
      }
      // groupName survivor kosong tapi salah satu duplikat punya nama -> pakai itu sementara (Fase 2 akan re-verifikasi ke WAHA)
      if (!survivor.groupName) {
        const nameFromDup = duplicates.find((d) => d.groupName)?.groupName;
        if (nameFromDup) {
          await prisma.conversation.update({ where: { id: survivor.id }, data: { groupName: nameFromDup } });
        }
      }
      console.log(`    ✓ DI-MERGE — ${duplicates.length} duplikat dihapus, message dipindah ke survivor.\n`);
    } else {
      console.log(`    [DRY-RUN] Akan merge: pindahkan message dari ${duplicates.map((d) => d.id).join(", ")} ke ${survivor.id}, lalu hapus duplikatnya.\n`);
    }
    merged++;
  }

  console.log(`Fase 1.5 selesai. ${DRY_RUN ? "[DRY-RUN] Akan " : ""}Di-merge: ${merged} grup duplikat.\n`);
  return { merged };
}

// Coba beberapa session berurutan sampai salah satu berhasil kasih nama grup.
// Kalau conv.sessionId sudah ada, coba itu dulu baru fallback ke session lain
// (self-healing kalau ternyata sessionId yang tersimpan salah/basi).
async function resolveGroupNameWithFallback(groupJid, storedSessionId) {
  const tryOrder = storedSessionId
    ? [storedSessionId, ...SESSIONS.filter((s) => s !== storedSessionId)]
    : SESSIONS;
  for (const session of tryOrder) {
    const name = await getGroupInfo(groupJid, session);
    if (name) return { name, session };
  }
  return { name: null, session: null };
}

async function backfillGroupNames() {
  console.log("=== FASE 2 — Backfill nama grup dari WAHA ===\n");

  const groups = await prisma.conversation.findMany({
    where: { type: "GROUP", groupJid: { not: STATUS_BROADCAST_JID } },
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
    if (conv.groupJid === STATUS_BROADCAST_JID) continue; // sudah dibersihkan Fase 0, jaga-jaga kalau lolos

    // sessionId null ATAU salah — coba berurutan CS-1 lalu CS-2 (atau
    // session tersimpan dulu baru fallback), self-healing: sessionId
    // di-update ke session yang TERBUKTI berhasil.
    const { name: freshName, session: workingSession } = await resolveGroupNameWithFallback(conv.groupJid, conv.sessionId);

    if (!freshName) {
      console.log(`  [GAGAL] ${conv.groupJid} — WAHA tidak kembalikan nama di session manapun (dicoba: ${(conv.sessionId ? [conv.sessionId, ...SESSIONS.filter((s) => s !== conv.sessionId)] : SESSIONS).join(", ")}). groupName lama: "${conv.groupName || "(null)"}" — tidak diubah.`);
      failed++;
      continue;
    }

    const sessionNeedsHealing = workingSession !== conv.sessionId;
    const nameNeedsUpdate = freshName !== conv.groupName;

    if (!nameNeedsUpdate && !sessionNeedsHealing) {
      console.log(`  [OK] ${conv.groupJid} — groupName sudah benar: "${freshName}" (session: ${workingSession})`);
      unchanged++;
      continue;
    }

    if (nameNeedsUpdate) {
      console.log(`  [BEDA] ${conv.groupJid} — lama: "${conv.groupName || "(null)"}" → baru: "${freshName}"`);
    }
    if (sessionNeedsHealing) {
      console.log(`  [SESSION] ${conv.groupJid} — sessionId lama: "${conv.sessionId || "(null)"}" → diperbaiki jadi: "${workingSession}"`);
    }

    if (!DRY_RUN) {
      await prisma.conversation.update({
        where: { id: conv.id },
        data:  { groupName: freshName, sessionId: workingSession },
      });
      console.log(`         ✓ Diupdate.`);
    } else {
      console.log(`         [DRY-RUN] Akan diupdate.`);
    }
    if (nameNeedsUpdate) {
      mapping.push({ groupJid: conv.groupJid, before: conv.groupName || "(null)", after: freshName });
    }
  }

  console.log(`\nFase 2 selesai. ${DRY_RUN ? "[DRY-RUN] Akan " : ""}Diupdate: ${mapping.length} | Sudah benar: ${unchanged} | Gagal/skip: ${failed}`);
  return { mapping, unchanged, failed };
}

async function main() {
  console.log(DRY_RUN ? "=== MODE DRY-RUN: TIDAK ADA data yang diubah ===\n" : "=== MODE LIVE: data AKAN diubah ===\n");

  await cleanupStatusBroadcast();
  await reclassifyMisclassifiedGroups();
  await dedupDuplicateGroups();
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
