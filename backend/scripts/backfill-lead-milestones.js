// Backfill milestone lead untuk data SEBELUM job leadMilestones aktif.
//
//   node scripts/backfill-lead-milestones.js          → dry-run (hitung saja)
//   node scripts/backfill-lead-milestones.js --apply  → tulis
//
// Yang diisi (HANYA kolom yang masih NULL — tidak pernah menimpa):
//   - Customer.quotedAt  = waktu pesan OUTBOUND pertama yang memuat harga,
//                          quotedSource = "BACKFILL".
//   - Customer.serviceArea dari Order.deliveryCity terbaru.
// Yang SENGAJA TIDAK dilakukan: menaikkan stage NEW → PROSPECT. Riwayat
// pipeline_transitions harus mencerminkan kejadian nyata, bukan
// rekonstruksi mundur — stage lama dibiarkan apa adanya.
import { prisma } from "../src/db.js";
import { PRICE_PATTERN_SQL, catatPenawaran, isiAreaDariOrder } from "../src/services/leadMilestones.js";

const apply = process.argv.includes("--apply");

const kandidat = await prisma.$queryRawUnsafe(
  `SELECT DISTINCT ON (u.id) u.id AS "customerId", m."createdAt" AS "at", m."sentById" AS "by"
     FROM "Customer" u
     JOIN "Conversation" c ON c."customerId" = u.id AND c.type = 'INDIVIDUAL'
     JOIN "Message" m ON m."conversationId" = c.id
    WHERE u.quoted_at IS NULL AND u.is_internal_staff = false
      AND m.direction = 'OUTBOUND' AND m.content ~* $1
    ORDER BY u.id, m."createdAt"`,
  PRICE_PATTERN_SQL,
);
const [{ area_kosong_berorder }] = await prisma.$queryRawUnsafe(
  `SELECT count(DISTINCT u.id)::int AS area_kosong_berorder FROM "Customer" u JOIN "Order" o ON o."customerId" = u.id
    WHERE u.service_area IS NULL AND o.delivery_city IS NOT NULL AND o.delivery_city <> ''`,
);

console.log(`Kandidat penawaran (pesan berharga, quotedAt kosong): ${kandidat.length}`);
console.log(`Pelanggan tanpa area yang punya kota pengiriman di order: ${area_kosong_berorder}`);

if (!apply) {
  console.log("Dry-run — tidak ada yang ditulis. Jalankan ulang dengan --apply.");
} else {
  const p = await catatPenawaran(prisma, kandidat, { source: "BACKFILL", naikkanStage: false });
  const a = await isiAreaDariOrder(prisma);
  console.log(`Ditulis: penawaran ${p.ditandai}, area ${a.diisi}`);
}
await prisma.$disconnect();
