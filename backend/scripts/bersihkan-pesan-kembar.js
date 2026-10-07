// Bersihkan pesan keluar KEMBAR di data lama (lihat src/utils/rencanaPesanKembar.js untuk penyebab & aturan memilih baris).
//
//   docker compose exec backend node scripts/bersihkan-pesan-kembar.js            # pratinjau (DEFAULT, tidak mengubah apa pun)
//   ./backend/scripts/backup-database.sh
//   docker compose exec backend node scripts/bersihkan-pesan-kembar.js --apply
//
// Keamanan: baris yang dihapus disalin ke tabel "backup_pesan_kembar_20261007" dalam transaksi yang sama; per batch 200 grup; batch dibatalkan
// bila jumlah terhapus tidak sama dengan rencana; balasan (replyToId) yang mengutip baris terhapus dialihkan ke baris yang dipertahankan.
// Idempotent. Jalankan scripts/resync-percakapan-basi.js SETELAH ini.
import { prisma } from "../src/db.js";
import { rencanaPesanKembar } from "../src/utils/rencanaPesanKembar.js";

const APPLY = process.argv.includes("--apply");
const TABEL_BACKUP = "backup_pesan_kembar_20261007";
const potong = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, (i + 1) * n));

async function muat() {
  return prisma.$queryRaw`
    SELECT m.id, m."conversationId", m.direction, m."externalId", m."sentById", m.ack, m."createdAt", m."mediaUrl", m."mediaType", m."thumbUrl", m."mediaWidth", m."mediaHeight"
    FROM "Message" m
    WHERE m.direction = 'OUTBOUND' AND m."externalId" IS NOT NULL
      AND (m."conversationId", split_part(m."externalId", '_', 3)) IN (
        SELECT "conversationId", split_part("externalId", '_', 3) FROM "Message"
        WHERE direction = 'OUTBOUND' AND "externalId" IS NOT NULL AND length(split_part("externalId", '_', 3)) >= 16
        GROUP BY 1, 2 HAVING count(*) > 1)`;
}

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY (MENGHAPUS)" : "DRY-RUN (tidak mengubah apa pun)"}\n`);
  const rows = await muat();
  const { rencana, dilewati } = rencanaPesanKembar(rows);
  const korbanIds = rencana.flatMap((r) => r.korban.map((k) => k.id));
  const dikutip = korbanIds.length ? await prisma.message.count({ where: { replyToId: { in: korbanIds } } }) : 0;
  const perBulan = {};
  const bentuk = {};
  for (const r of rencana) {
    const b = new Date(r.survivor.createdAt).toISOString().slice(0, 7);
    perBulan[b] = (perBulan[b] || 0) + r.korban.length;
    const k = `${r.survivor.sentById ? "asli-CRM" : "asli-sistem"}+${r.korban.length}kembar`;
    bentuk[k] = (bentuk[k] || 0) + 1;
  }
  console.log(`Baris kandidat dibaca            : ${rows.length}`);
  console.log(`Grup kembar yang akan dirapikan  : ${rencana.length}`);
  console.log(`Baris kembar yang akan DIHAPUS   : ${korbanIds.length}`);
  console.log(`Grup dilewati (waktu berjauhan)  : ${dilewati.length}`);
  console.log(`Balasan yang akan dialihkan      : ${dikutip}`);
  console.log("Bentuk grup:", bentuk);
  console.log("Per bulan:", perBulan);
  if (!APPLY) { console.log("\nPRATINJAU. Backup database dulu, lalu jalankan ulang dengan --apply."); return; }
  if (!rencana.length) { console.log("\nTidak ada yang perlu dibersihkan."); return; }

  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "${TABEL_BACKUP}" (LIKE "Message")`);
  let hapus = 0;
  for (const batch of potong(rencana, 200)) {
    const ids = batch.flatMap((r) => r.korban.map((k) => k.id));
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`INSERT INTO "${TABEL_BACKUP}" SELECT * FROM "Message" WHERE id = ANY($1::text[])`, ids);
      for (const r of batch) {
        await tx.message.updateMany({ where: { replyToId: { in: r.korban.map((k) => k.id) } }, data: { replyToId: r.survivor.id } });
        const data = {};
        if (r.ackBaru != null) data.ack = r.ackBaru;
        if (r.sumberMedia) Object.assign(data, { mediaUrl: r.sumberMedia.mediaUrl, mediaType: r.sumberMedia.mediaType, thumbUrl: r.sumberMedia.thumbUrl, mediaWidth: r.sumberMedia.mediaWidth, mediaHeight: r.sumberMedia.mediaHeight });
        if (Object.keys(data).length) await tx.message.update({ where: { id: r.survivor.id }, data });
      }
      const { count } = await tx.message.deleteMany({ where: { id: { in: ids } } });
      if (count !== ids.length) throw new Error(`Batch dibatalkan: rencana ${ids.length} baris, terhapus ${count}`);
    }, { timeout: 120_000 });
    hapus += ids.length;
    console.log(`  ...${hapus}/${korbanIds.length} dihapus`);
  }
  console.log(`\nSelesai: ${hapus} baris kembar dihapus. Salinan di tabel "${TABEL_BACKUP}".`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
