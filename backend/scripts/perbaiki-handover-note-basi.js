// Perbaiki catatan serah-terima (Conversation.handoverNote) yang BASI: percakapan yang event terakhirnya TRANSFER tetapi catatannya masih bunyi
// "diambil alih dari X oleh Y" dari takeover lama — banner konteks di chat menunjuk orang yang bukan pemegangnya (audit 11 Okt 2026: 26 dari 32).
// Penyebab sudah diperbaiki di kode (transfer kini menulis handoverNote); skrip ini merapikan data lama saja.
//
// Hanya menyentuh percakapan yang: event terakhirnya "transfer", catatannya terisi, dan TIDAK menyebut nama pemegang sekarang.
// Isi baru memakai fakta dari riwayat: "Percakapan ditransfer dari <A> ke <B>." (pelaku tidak tercatat di riwayat lama, jadi tidak disebut).
//
//   docker compose exec backend node scripts/perbaiki-handover-note-basi.js            # pratinjau (DEFAULT, tidak mengubah apa pun)
//   ./backend/scripts/backup-database.sh
//   docker compose exec backend node scripts/perbaiki-handover-note-basi.js --apply
// Nilai lama disimpan di tabel "backup_handover_note_20261011". Idempotent.
import { prisma } from "../src/db.js";

const APPLY = process.argv.includes("--apply");
const TABEL_BACKUP = "backup_handover_note_20261011";

async function muat() {
  return prisma.$queryRaw`
    WITH terakhir AS (
      SELECT DISTINCT ON ("conversationId") "conversationId" cid, reason, "fromUserId", "toUserId"
      FROM "HandoverEvent" ORDER BY "conversationId", "createdAt" DESC, id DESC)
    SELECT c.id, c."handoverNote" AS note, uf.name AS dari, ut.name AS ke
    FROM "Conversation" c
    JOIN terakhir t ON t.cid = c.id AND t.reason = 'transfer'
    JOIN "User" ut ON ut.id = t."toUserId"
    LEFT JOIN "User" uf ON uf.id = t."fromUserId"
    WHERE c."handoverNote" IS NOT NULL AND c."assignedToId" = t."toUserId"
      AND position(lower(ut.name) in lower(c."handoverNote")) = 0`;
}

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY" : "DRY-RUN (tidak mengubah apa pun)"}\n`);
  const rows = await muat();
  console.log(`Catatan serah-terima basi: ${rows.length}`);
  for (const r of rows.slice(0, 5)) console.log(`  contoh ${r.id}: "${String(r.note).slice(0, 70)}" → ke ${r.ke}`);
  if (!APPLY) { console.log("\nPRATINJAU. Backup database dulu, lalu jalankan ulang dengan --apply."); return; }
  if (!rows.length) { console.log("\nTidak ada yang perlu diperbaiki."); return; }
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "${TABEL_BACKUP}" (id text, "handoverNote" text, dicatat timestamp DEFAULT now())`);
  let n = 0;
  for (const r of rows) {
    const baru = r.dari ? `Percakapan ditransfer dari ${r.dari} ke ${r.ke}.` : `Percakapan ditransfer ke ${r.ke}.`;
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`INSERT INTO "${TABEL_BACKUP}" (id, "handoverNote") VALUES ($1, $2)`, r.id, r.note);
      // Guard: hanya bila catatannya masih sama seperti yang dibaca (tidak menimpa perubahan yang masuk selagi skrip jalan).
      await tx.conversation.updateMany({ where: { id: r.id, handoverNote: r.note }, data: { handoverNote: baru } });
    });
    n++;
  }
  console.log(`\nSelesai: ${n} catatan diperbaiki. Nilai lama di tabel "${TABEL_BACKUP}".`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
