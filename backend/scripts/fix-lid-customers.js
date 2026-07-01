// Script cleanup: hapus phone LID yang tersimpan salah di database
// Jalankan: docker compose exec backend node scripts/fix-lid-customers.js

import { prisma } from "../src/db.js";

function isLidPhone(phone) {
  if (!phone) return false;
  if (phone.includes("@")) return true;          // masih ada suffix @lid
  if (!phone.startsWith("62") && phone.length > 13) return true; // angka LID panjang
  return false;
}

async function main() {
  console.log("=== Fix LID Customers ===\n");

  const all = await prisma.customer.findMany({
    select: {
      id: true, phone: true, name: true, instagramHandle: true,
      _count: { select: { conversations: true, orders: true } },
    },
  });

  const suspicious = all.filter((c) => isLidPhone(c.phone));

  if (suspicious.length === 0) {
    console.log("Tidak ada customer dengan phone LID yang mencurigakan. Selesai.");
    await prisma.$disconnect();
    return;
  }

  console.log(`Ditemukan ${suspicious.length} customer dengan phone mencurigakan:\n`);

  let nulled = 0;

  for (const c of suspicious) {
    console.log(`  ID: ${c.id}`);
    console.log(`  Nama: ${c.name || "(kosong)"}`);
    console.log(`  Phone (LID): ${c.phone}`);
    console.log(`  Instagram: ${c.instagramHandle || "(kosong)"}`);
    console.log(`  Percakapan: ${c._count.conversations} | Order: ${c._count.orders}`);

    // Set phone = null (lebih baik kosong daripada menyimpan LID yang salah)
    await prisma.customer.update({
      where: { id: c.id },
      data: { phone: null },
    });
    nulled++;
    console.log(`  ✓ Phone di-reset ke null\n`);
  }

  console.log(`\n=== Selesai ===`);
  console.log(`Total ditemukan : ${suspicious.length}`);
  console.log(`Total di-null-kan: ${nulled}`);
  console.log(`\nCatatan: customer ini tetap ada di database (conversations & orders tetap).`);
  console.log(`Jika pelanggan kirim pesan lagi dengan nomor asli, sistem akan create customer baru.`);
  console.log(`Admin bisa merge manual lewat Prisma Studio jika diperlukan.`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
