// Script migrasi satu kali: set customerType = CORPORATE untuk semua Customer
// yang punya tag "korporat" (case-insensitive).
// Tag-nya TIDAK dihapus — biar histori tetap ada.
//
// Cara pakai:
//   node scripts/migrate-korporat-tag.js
// atau dari Docker:
//   docker compose exec backend node scripts/migrate-korporat-tag.js

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Ambil semua customer yang belum CORPORATE
  const customers = await prisma.customer.findMany({
    where: { customerType: "END_USER" },
    select: { id: true, name: true, phone: true, tags: true },
  });

  let updated = 0;
  for (const c of customers) {
    const hasKorporat = c.tags.some((t) => t.toLowerCase() === "korporat");
    if (hasKorporat) {
      await prisma.customer.update({
        where: { id: c.id },
        data: { customerType: "CORPORATE" },
      });
      console.log(`  ✓ [${c.phone || c.name || c.id}] → CORPORATE (tags: ${c.tags.join(", ")})`);
      updated++;
    }
  }

  console.log(`\nSelesai. ${updated} dari ${customers.length} customer di-update ke CORPORATE.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
