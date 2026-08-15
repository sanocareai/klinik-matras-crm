// Melengkapi leadSourceDetail lead Meta RETROAKTIF dengan TEMPLATE IKLAN
// yang diklik, diambil dari pesan pertama customer.
//
// LATAR BELAKANG. Backfill 13 Agt 2026 menandai ~938 pelanggan sebagai
// META_ADS lewat pencocokan template pesan, tapi menuliskan detail yang
// sama untuk semuanya: "Meta Ads (retroaktif: template chat iklan),
// campaign tidak diketahui". Di laporan "Rincian per Iklan" itu muncul
// sebagai SATU baris raksasa yang tidak bisa ditindaklanjuti.
//
// Ternyata pesan pertama mereka BERBEDA-BEDA dan justru informatif — itu
// teks prefilled dari iklan Click-to-WhatsApp, jadi menunjukkan ANGLE
// iklan mana yang menarik orang:
//   "Minta estimasi harga dan proses pengerjaan"       383 lead
//   "Ingin upgrade kasur lama agar lebih nyaman"       202 lead
//   "Bangun tidur terasa pegal atau kurang nyaman"     191 lead
//   ...
//
// ⚠️ YANG TIDAK BISA DIPULIHKAN: platform (Facebook vs Instagram). Sinyal
// itu memang TIDAK PERNAH tersimpan sebelum perbaikan CTWA 13 Agt 2026 —
// satu template iklan bisa tayang di dua-duanya sekaligus. Script ini
// SENGAJA tidak menebaknya; detail baru tetap menyebut "platform tidak
// diketahui" supaya laporan tidak memalsukan kepastian yang tidak ada.
//
// PEMAKAIAN (dry-run dulu — DEFAULT tidak mengubah apa pun):
//   docker compose exec backend node scripts/backfill-template-iklan.js
//   docker compose exec backend node scripts/backfill-template-iklan.js --apply

import { prisma } from "../src/db.js";

const PREFIX_LAMA = "Meta Ads (retroaktif";
const APPLY = process.argv.includes("--apply");

/** Rapikan teks template jadi satu baris pendek untuk dipakai di label. */
function ringkasTemplate(teks) {
  return String(teks || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

const kandidat = await prisma.customer.findMany({
  where: { leadSourceDetail: { startsWith: PREFIX_LAMA } },
  select: {
    id: true,
    leadSourceDetail: true,
    conversations: {
      where: { channel: "WHATSAPP" },
      orderBy: { lastMessageAt: "asc" },
      take: 1,
      select: {
        messages: {
          where: { direction: "INBOUND" },
          orderBy: { createdAt: "asc" },
          take: 1,
          select: { content: true },
        },
      },
    },
  },
});

console.log(`Kandidat (detail diawali "${PREFIX_LAMA}"): ${kandidat.length}`);

const rencana = new Map(); // detailBaru -> jumlah
const update = [];
let tanpaPesan = 0;

for (const c of kandidat) {
  const pesan = ringkasTemplate(c.conversations[0]?.messages[0]?.content);
  if (!pesan) { tanpaPesan++; continue; }

  // Platform SENGAJA tetap "tidak diketahui" — lihat catatan di atas.
  const detailBaru = `Meta Ads - template: "${pesan}" (platform tidak diketahui)`;
  rencana.set(detailBaru, (rencana.get(detailBaru) || 0) + 1);
  update.push({ id: c.id, detailBaru });
}

console.log(`Tanpa pesan masuk (dilewati, detail lama dipertahankan): ${tanpaPesan}`);
console.log(`Akan diperbarui: ${update.length}\n`);
console.log("Rencana pengelompokan baru:");
for (const [detail, n] of [...rencana.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)}  ${detail}`);
}

if (!APPLY) {
  console.log("\n(DRY-RUN — tidak ada yang diubah. Tambahkan --apply untuk menerapkan.)");
  process.exit(0);
}

// Dikelompokkan per detail supaya jadi beberapa updateMany, bukan ribuan
// update satu-satu.
const perDetail = new Map();
for (const u of update) {
  if (!perDetail.has(u.detailBaru)) perDetail.set(u.detailBaru, []);
  perDetail.get(u.detailBaru).push(u.id);
}

let total = 0;
for (const [detail, ids] of perDetail) {
  const r = await prisma.customer.updateMany({
    where: { id: { in: ids } },
    data: { leadSourceDetail: detail },
  });
  total += r.count;
  console.log(`  ${r.count} diperbarui -> ${detail}`);
}
console.log(`\nSelesai. Total diperbarui: ${total}`);
process.exit(0);
