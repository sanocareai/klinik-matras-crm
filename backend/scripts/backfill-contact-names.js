// Backfill nama Customer dari kontak tersimpan WAHA — prioritas SAMA
// dengan resolveCustomerName() di webhooks.js: nama TERSIMPAN di HP CS
// (WAHA field "name", paling otoritatif) > pushName (WAHA field "pushname",
// nama yang customer set sendiri di profil WA-nya) > tetap seperti semula
// kalau WAHA tidak tahu dua-duanya.
//
// CATATAN AKURASI: backend TIDAK PERNAH literal menyimpan nomor telepon ke
// Customer.name (kalau tidak ada pushName, name disimpan NULL — UI baru
// fallback tampilkan phone di layar, lihat `name || phone` di
// Customers.jsx/PelangganScreen.js/dst). Jadi kandidat "nama masih berupa
// nomor mentah" di bawah mencakup DUA kasus: name kosong (kasus normal/
// mayoritas) DAN name yang literal berisi angka mirip nomor telepon (kasus
// data lama/import Excel yang mungkin kebetulan begitu) — supaya tidak ada
// yang lolos dari scan hanya karena representasinya beda dari dugaan awal.
//
// JANGAN sentuh Customer yang nameManuallyEdited=true — itu sudah dikoreksi
// sales sendiri di CRM, WAJIB dihormati, jangan pernah ditimpa otomatis.
//
// Session dicoba berurutan: sessionId dari Conversation TERBARU customer
// ini (kalau ada), lalu CS-1, CS-2 — pola sama dengan
// backfill-group-names.js / backfill-customer-avatars.js.
//
// WAJIB --dry-run dulu untuk preview:
//   docker compose exec backend node scripts/backfill-contact-names.js --dry-run
// Baru jalankan sungguhan setelah hasil di-review:
//   docker compose exec backend node scripts/backfill-contact-names.js

import { prisma } from "../src/db.js";
import { getContactInfo } from "../src/services/wahaClient.js";

const DRY_RUN = process.argv.includes("--dry-run");
const SESSIONS = ["CS-1", "CS-2"];
const PHONE_LIKE_REGEX = /^\+?\d{8,15}$/;

function looksLikePhoneOrEmpty(name) {
  if (!name || !name.trim()) return true;
  return PHONE_LIKE_REGEX.test(name.trim());
}

async function resolveWithFallback(phone, storedSession) {
  const tryOrder = storedSession ? [storedSession, ...SESSIONS.filter((s) => s !== storedSession)] : SESSIONS;
  for (const session of tryOrder) {
    const contact = await getContactInfo(phone, session);
    if (contact) return { contact, session };
  }
  return { contact: null, session: null };
}

async function main() {
  console.log(DRY_RUN ? "=== MODE DRY-RUN: TIDAK ADA data yang diubah ===\n" : "=== MODE LIVE: data AKAN diubah ===\n");

  const customers = await prisma.customer.findMany({
    where: { phone: { not: null }, nameManuallyEdited: false },
    include: {
      conversations: { select: { sessionId: true }, orderBy: { lastMessageAt: "desc" }, take: 1 },
    },
  });

  const candidates = customers.filter((c) => looksLikePhoneOrEmpty(c.name));
  console.log(`Total customer (belum pernah diedit manual sales): ${customers.length}.`);
  console.log(`Kandidat (nama kosong atau berupa nomor mentah): ${candidates.length}.\n`);

  let gotStoredName = 0, gotPushName = 0, stillUnknown = 0;

  for (const c of candidates) {
    const storedSession = c.conversations[0]?.sessionId || null;
    const { contact, session } = await resolveWithFallback(c.phone, storedSession);

    if (contact?.name) {
      console.log(`  [NAMA TERSIMPAN] ${c.phone} — lama: "${c.name || "(kosong)"}" → baru: "${contact.name}" (via ${session})`);
      if (!DRY_RUN) {
        await prisma.customer.update({ where: { id: c.id }, data: { name: contact.name } });
        console.log(`         ✓ Diupdate.`);
      } else {
        console.log(`         [DRY-RUN] Akan diupdate.`);
      }
      gotStoredName++;
    } else if (contact?.pushname) {
      console.log(`  [PUSHNAME] ${c.phone} — lama: "${c.name || "(kosong)"}" → baru: "${contact.pushname}" (via ${session})`);
      if (!DRY_RUN) {
        await prisma.customer.update({ where: { id: c.id }, data: { name: contact.pushname } });
        console.log(`         ✓ Diupdate.`);
      } else {
        console.log(`         [DRY-RUN] Akan diupdate.`);
      }
      gotPushName++;
    } else {
      console.log(`  [TETAP] ${c.phone} — WAHA tidak tahu nama tersimpan maupun pushname (dicoba: ${SESSIONS.join(", ")}). Tidak diubah.`);
      stillUnknown++;
    }
  }

  console.log(
    `\nSelesai. ${DRY_RUN ? "[DRY-RUN] Akan " : ""}Dapat nama tersimpan: ${gotStoredName} | Dapat pushName saja: ${gotPushName} | Tetap tidak diketahui: ${stillUnknown}`
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
