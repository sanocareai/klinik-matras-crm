// Script migrasi: normalisasi nomor telepon 0xxx → 62xxx
// Jalankan SEKALI di lokal setelah update cleanPhoneNumber di wahaClient.js:
//   node backend/scripts/fix-phone-normalization.js
//
// Aman dijalankan berkali-kali — setelah run pertama tidak ada lagi phone starting "0".

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Cari semua customer dengan nomor format lokal (0xxx)
  const customers = await prisma.customer.findMany({
    where: { phone: { startsWith: "0" } },
  });

  console.log(`[fix-phone] Ditemukan ${customers.length} customer dengan format 0xxx`);
  if (!customers.length) {
    console.log("[fix-phone] Tidak ada yang perlu difix. Selesai.");
    return;
  }

  let updated = 0, merged = 0, skipped = 0;

  for (const c of customers) {
    const normalized = "62" + c.phone.slice(1);

    // Cek apakah customer dengan nomor 62xxx sudah ada
    const existing = await prisma.customer.findUnique({ where: { phone: normalized } });

    if (existing) {
      // MERGE: pindahkan semua relasi dari customer duplikat (0xxx) ke yang sudah ada (62xxx)
      console.log(`[fix-phone] MERGE: ${c.phone} → ${normalized} (gabungkan ke id: ${existing.id})`);

      await prisma.conversation.updateMany({
        where: { customerId: c.id },
        data: { customerId: existing.id },
      });
      await prisma.order.updateMany({
        where: { customerId: c.id },
        data: { customerId: existing.id },
      });
      await prisma.note.updateMany({
        where: { customerId: c.id },
        data: { customerId: existing.id },
      });

      // Hapus customer duplikat yang 0xxx
      await prisma.customer.delete({ where: { id: c.id } });
      console.log(`  → Merge selesai, customer ${c.id} dihapus`);
      merged++;
    } else {
      // Tidak ada duplikat — cukup update nomor
      await prisma.customer.update({
        where: { id: c.id },
        data: { phone: normalized },
      });
      console.log(`[fix-phone] UPDATE: ${c.phone} → ${normalized}`);
      updated++;
    }
  }

  console.log(`\n[fix-phone] Selesai: ${updated} diupdate, ${merged} di-merge, ${skipped} dilewati`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
