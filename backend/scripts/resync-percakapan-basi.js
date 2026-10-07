// Rapikan percakapan yang lastMessageAt/lastMessagePreview-nya TERTINGGAL dari pesan terbarunya (Inbox menampilkan pesan lama, chat yang sudah
// dibalas tampak belum dibalas). Hanya MAJU: lastMessageAt diset ke waktu pesan terbaru & preview ke isi pesan itu — tidak pernah mundur,
// tidak menyentuh status/unread/pemegang. Ambang: tertinggal > 5 menit (selisih lebih kecil wajar: dua pesan beruntun).
//
//   docker compose exec backend node scripts/resync-percakapan-basi.js            # pratinjau (DEFAULT)
//   ./backend/scripts/backup-database.sh
//   docker compose exec backend node scripts/resync-percakapan-basi.js --apply
// Nilai lama disimpan di tabel "backup_resync_percakapan_20261007". Jalankan SETELAH bersihkan-pesan-kembar.js. Idempotent.
import { prisma } from "../src/db.js";
import { buildMessagePreview } from "../src/utils/messagePreview.js";

const APPLY = process.argv.includes("--apply");
const TABEL_BACKUP = "backup_resync_percakapan_20261007";

async function muat() {
  return prisma.$queryRaw`
    SELECT c.id, c."lastMessageAt", c."lastMessagePreview", t.id AS "msgId", t."createdAt" AS "msgAt", t.content, t."mediaType", t.direction
    FROM "Conversation" c
    JOIN LATERAL (SELECT id, "createdAt", content, "mediaType", direction FROM "Message" WHERE "conversationId" = c.id ORDER BY "createdAt" DESC, id DESC LIMIT 1) t ON true
    WHERE c."lastMessageAt" < t."createdAt" - interval '5 minutes'`;
}

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY" : "DRY-RUN (tidak mengubah apa pun)"}\n`);
  const rows = await muat();
  const selisihJam = rows.map((r) => (new Date(r.msgAt) - new Date(r.lastMessageAt)) / 3.6e6).sort((a, b) => a - b);
  console.log(`Percakapan tertinggal: ${rows.length}`);
  if (rows.length) console.log(`Selisih (jam): median ${selisihJam[Math.floor(selisihJam.length / 2)].toFixed(1)}, maks ${selisihJam.at(-1).toFixed(1)}`);
  console.log(`Pesan terbaru berarah: keluar ${rows.filter((r) => r.direction === "OUTBOUND").length}, masuk ${rows.filter((r) => r.direction === "INBOUND").length}`);
  if (!APPLY) { console.log("\nPRATINJAU. Backup database dulu, lalu jalankan ulang dengan --apply."); return; }
  if (!rows.length) { console.log("\nTidak ada yang perlu dirapikan."); return; }
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "${TABEL_BACKUP}" (id text, "lastMessageAt" timestamp(3), "lastMessagePreview" text, dicatat timestamp DEFAULT now())`);
  let n = 0;
  for (const r of rows) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`INSERT INTO "${TABEL_BACKUP}" (id, "lastMessageAt", "lastMessagePreview") VALUES ($1, $2, $3)`, r.id, r.lastMessageAt, r.lastMessagePreview);
      // Guard: hanya maju (kalau ada pesan baru masuk selagi skrip jalan, nilai yang lebih baru tidak ditimpa).
      await tx.conversation.updateMany({ where: { id: r.id, lastMessageAt: { lt: r.msgAt } }, data: { lastMessageAt: r.msgAt, lastMessagePreview: buildMessagePreview(r.content, r.mediaType) } });
    });
    n++;
  }
  console.log(`\nSelesai: ${n} percakapan dirapikan. Nilai lama di tabel "${TABEL_BACKUP}".`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
