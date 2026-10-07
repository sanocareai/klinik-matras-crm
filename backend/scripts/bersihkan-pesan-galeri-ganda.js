// Bersihkan pesan galeri GANDA di data lama (akibat bug sebelum 1 Okt 2026 — lihat src/utils/pasangPesanGaleriGanda.js).
//
// Satu foto Galeri Produk / Dokumentasi yang terkirim tersimpan DUA kali: "hantu" (baris dari rute galeri: tanpa externalId, ack 0 selamanya)
// dan "gema" (baris dari webhook WAHA: externalId & ack asli). Skrip ini MENGHAPUS hantu yang punya gema pasangan, dan memindahkan balasan
// yang mengutip hantu ke gemanya. Hantu TANPA pasangan dibiarkan (kemungkinan gema tidak pernah datang — bukan duplikat yang terbukti).
//
// Keamanan:
//   - DEFAULT = dry-run (hanya membaca & melaporkan). Menghapus HANYA dengan --apply.
//   - Sebelum --apply: backup database (./backend/scripts/backup-database.sh). Skrip juga menyalin baris yang dihapus ke tabel
//     "backup_pesan_galeri_ganda_20261007" (satu transaksi dengan penghapusannya) — bisa dikembalikan dengan INSERT ... SELECT.
//   - Per batch dalam SATU transaksi; kalau jumlah baris yang terhapus tidak sama dengan yang direncanakan → batal (rollback).
//   - Idempotent: dijalankan ulang hanya memproses sisa.
//
//   docker compose exec backend node scripts/bersihkan-pesan-galeri-ganda.js            # pratinjau
//   ./backend/scripts/backup-database.sh
//   docker compose exec backend node scripts/bersihkan-pesan-galeri-ganda.js --apply

import { prisma } from "../src/db.js";
import { pasangkanPesanGaleri } from "../src/utils/pasangPesanGaleriGanda.js";

const APPLY = process.argv.includes("--apply");
const TABEL_BACKUP = "backup_pesan_galeri_ganda_20261007";
const UKURAN_BATCH = 200;
const FOLDER_GALERI = ["/media/products/", "/media/job-photos/"];

const potong = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, (i + 1) * n));

async function muatHantu() {
  return prisma.message.findMany({
    where: {
      direction: "OUTBOUND", externalId: null, mediaType: "image",
      OR: FOLDER_GALERI.map((f) => ({ mediaUrl: { startsWith: f } })),
    },
    select: { id: true, conversationId: true, content: true, mediaType: true, createdAt: true, direction: true },
  });
}

async function muatGema(conversationIds) {
  const hasil = [];
  for (const grup of potong(conversationIds, 500)) {
    hasil.push(...await prisma.message.findMany({
      where: { conversationId: { in: grup }, direction: "OUTBOUND", mediaType: "image", externalId: { not: null }, sentById: null, mediaUrl: { not: null } },
      select: { id: true, conversationId: true, content: true, mediaType: true, createdAt: true, direction: true, externalId: true, sentById: true, mediaUrl: true },
    }));
  }
  return hasil;
}

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY (MENGHAPUS)" : "DRY-RUN (tidak mengubah apa pun)"}\n`);
  const hantu = await muatHantu();
  const gema = await muatGema([...new Set(hantu.map((h) => h.conversationId))]);
  const { pasangan, tanpaPasangan } = pasangkanPesanGaleri(hantu, gema);

  const hantuIds = pasangan.map((p) => p.hantu.id);
  const dikutip = hantuIds.length ? await prisma.message.count({ where: { replyToId: { in: hantuIds } } }) : 0;
  const perBulan = {};
  for (const p of pasangan) { const b = p.hantu.createdAt.toISOString().slice(0, 7); perBulan[b] = (perBulan[b] || 0) + 1; }
  const selisih = pasangan.map((p) => p.selisihDetik).sort((a, b) => a - b);

  console.log(`Hantu galeri (tanpa externalId): ${hantu.length}`);
  console.log(`  dipasangkan dengan gema      : ${pasangan.length}  ← akan DIHAPUS`);
  console.log(`  tanpa pasangan (dibiarkan)   : ${tanpaPasangan.length}`);
  console.log(`Balasan yang mengutip hantu terpasang (akan dialihkan ke gema): ${dikutip}`);
  if (selisih.length) console.log(`Selisih waktu hantu↔gema: median ${selisih[Math.floor(selisih.length / 2)].toFixed(2)} dtk, maks ${selisih.at(-1).toFixed(2)} dtk`);
  console.log("Per bulan:", perBulan);
  for (const h of tanpaPasangan.slice(0, 5)) console.log(`  contoh tanpa pasangan: ${h.id} ${h.createdAt.toISOString()} ${JSON.stringify((h.content || "").slice(0, 40))}`);

  if (!APPLY) {
    console.log("\nIni PRATINJAU. Backup database dulu (./backend/scripts/backup-database.sh), lalu jalankan ulang dengan --apply.");
    return;
  }
  if (pasangan.length === 0) { console.log("\nTidak ada yang perlu dibersihkan."); return; }

  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "${TABEL_BACKUP}" (LIKE "Message")`);
  let terhapus = 0;
  for (const batch of potong(pasangan, UKURAN_BATCH)) {
    const ids = batch.map((p) => p.hantu.id);
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`INSERT INTO "${TABEL_BACKUP}" SELECT * FROM "Message" WHERE id = ANY($1::text[])`, ids);
      for (const p of batch) {
        await tx.message.updateMany({ where: { replyToId: p.hantu.id }, data: { replyToId: p.gema.id } });
      }
      // Pengaman: hanya baris yang MASIH hantu (tanpa externalId) yang boleh terhapus.
      const { count } = await tx.message.deleteMany({ where: { id: { in: ids }, externalId: null } });
      if (count !== ids.length) throw new Error(`Batch dibatalkan: seharusnya menghapus ${ids.length} baris, nyatanya ${count}`);
    }, { timeout: 60_000 });
    terhapus += ids.length;
    console.log(`  ...${terhapus}/${pasangan.length} dihapus`);
  }
  console.log(`\nSelesai: ${terhapus} pesan hantu dihapus. Salinan ada di tabel "${TABEL_BACKUP}".`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
