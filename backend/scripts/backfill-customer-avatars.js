// Backfill foto profil WA untuk Customer INDIVIDUAL.
//
// CATATAN: sebelum script ini dibuat, TIDAK ADA backfill avatar sama sekali
// — cuma ada scripts/backfill-group-names.js, dan itu untuk NAMA grup,
// bukan foto (grup tidak punya konsep foto profil di skema ini, cuma
// groupName — lihat CLAUDE.md "Conversation type GROUP vs INDIVIDUAL").
// Jadi cakupan script ini BARU, bukan "diperluas" dari yang sudah ada.
//
// Juga sekalian membenahi akibat bug lama: webhooks.js#maybeFetchProfilePicture
// (dan sebelumnya, pemanggilan langsung getProfilePicture di webhook) TIDAK
// PERNAH benar-benar berhasil menyimpan foto — endpoint WAHA yang dipanggil
// salah pola URL (lihat catatan panjang di wahaClient.js#getProfilePicture),
// jadi profilePictureUrl semua customer lama kemungkinan besar masih null
// walau kelihatannya "sudah pernah dicoba".
//
// Kandidat: Customer.phone ada (bukan cuma Instagram) DAN
// (profilePictureUrl kosong ATAU profilePictureFetchedAt kosong ATAU
// sudah > 7 hari — TTL sama dengan webhooks.js).
//
// Session dicoba berurutan: sessionId dari Conversation TERBARU customer
// ini (kalau ada), lalu CS-1, CS-2 — pola sama dengan
// backfill-group-names.js#resolveGroupNameWithFallback.
//
// WAJIB --dry-run dulu untuk preview:
//   docker compose exec backend node scripts/backfill-customer-avatars.js --dry-run
// Baru jalankan sungguhan setelah hasil di-review:
//   docker compose exec backend node scripts/backfill-customer-avatars.js

import { prisma } from "../src/db.js";
import { getProfilePicture } from "../src/services/wahaClient.js";

const DRY_RUN = process.argv.includes("--dry-run");
const SESSIONS = ["CS-1", "CS-2"];
const PROFILE_PIC_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function needsFetch(c) {
  if (!c.profilePictureUrl) return true;
  if (!c.profilePictureFetchedAt) return true;
  return Date.now() - c.profilePictureFetchedAt.getTime() > PROFILE_PIC_TTL_MS;
}

async function resolveWithFallback(phone, storedSession) {
  const tryOrder = storedSession ? [storedSession, ...SESSIONS.filter((s) => s !== storedSession)] : SESSIONS;
  for (const session of tryOrder) {
    const url = await getProfilePicture(phone, session);
    if (url) return { url, session };
  }
  return { url: null, session: null };
}

async function main() {
  console.log(DRY_RUN ? "=== MODE DRY-RUN: TIDAK ADA data yang diubah ===\n" : "=== MODE LIVE: data AKAN diubah ===\n");

  const customers = await prisma.customer.findMany({
    where: { phone: { not: null } },
    include: {
      conversations: { select: { sessionId: true }, orderBy: { lastMessageAt: "desc" }, take: 1 },
    },
  });

  const candidates = customers.filter(needsFetch);
  const skipped = customers.length - candidates.length;
  console.log(`Total customer dengan nomor WA: ${customers.length}.`);
  console.log(`Kandidat fetch (foto kosong/belum pernah dicoba/sudah >7 hari): ${candidates.length}.`);
  console.log(`Dilewati (sudah ada foto & masih dalam TTL 7 hari): ${skipped}.\n`);

  let updated = 0, failed = 0;

  for (const c of candidates) {
    const storedSession = c.conversations[0]?.sessionId || null;
    const { url, session } = await resolveWithFallback(c.phone, storedSession);

    if (!url) {
      console.log(`  [GAGAL] ${c.phone} (${c.name || "-"}) — tidak ada foto di ${SESSIONS.join("/")} (privasi dibatasi atau memang tidak ada — WAJAR).`);
      failed++;
      if (!DRY_RUN) {
        await prisma.customer.update({ where: { id: c.id }, data: { profilePictureFetchedAt: new Date() } });
      }
      continue;
    }

    console.log(`  [DAPAT] ${c.phone} (${c.name || "-"}) — via ${session}`);
    if (!DRY_RUN) {
      await prisma.customer.update({
        where: { id: c.id },
        data: { profilePictureUrl: url, profilePictureFetchedAt: new Date() },
      });
      console.log(`         ✓ Diupdate.`);
    } else {
      console.log(`         [DRY-RUN] Akan diupdate.`);
    }
    updated++;
  }

  console.log(
    `\nSelesai. ${DRY_RUN ? "[DRY-RUN] Akan " : ""}Diupdate: ${updated} | Gagal/tidak ada foto: ${failed} | Dilewati (sudah ada, belum expired): ${skipped}`
  );
  if (DRY_RUN) {
    console.log("\n[DRY-RUN selesai] Jalankan tanpa --dry-run setelah hasil di atas di-review untuk terapkan perubahan.");
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
