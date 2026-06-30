// Script identifikasi customer dengan nomor LID yang tersimpan salah.
// Jalankan SETELAH deploy fix webhook:
//   node backend/cleanup-lid.js
//
// Script ini HANYA TAMPILKAN daftar — tidak hapus otomatis.
// Hapus manual via Prisma Studio atau konfirmasikan ke Claude Code.

import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const allCustomers = await prisma.customer.findMany({
  where: { phone: { not: null } },
  select: { id: true, phone: true, name: true, createdAt: true, conversations: { select: { id: true } } },
});

// LID: lebih dari 13 digit dan TIDAK diawali "62" (kode Indonesia)
// Nomor HP Indonesia normal: 10-15 digit, mulai dari 62
const suspectLIDs = allCustomers.filter((c) => {
  const p = c.phone || "";
  return p.length > 13 && !p.startsWith("62");
});

if (suspectLIDs.length === 0) {
  console.log("✓ Tidak ada record LID yang mencurigakan. Database bersih.");
} else {
  console.log(`\n⚠️  Ditemukan ${suspectLIDs.length} customer dengan nomor yang mungkin LID:\n`);
  suspectLIDs.forEach((c) => {
    console.log(`  ID:       ${c.id}`);
    console.log(`  Phone:    ${c.phone}`);
    console.log(`  Nama:     ${c.name || "(kosong)"}`);
    console.log(`  Dibuat:   ${c.createdAt.toLocaleString("id-ID")}`);
    console.log(`  Conv:     ${c.conversations.length} percakapan`);
    console.log("");
  });

  console.log("──────────────────────────────────────────");
  console.log("Cara hapus (pilih salah satu):");
  console.log("  1. Prisma Studio: npx prisma studio → tabel Customer → hapus manual");
  console.log("  2. Via CRM: buka profil customer → koreksi nomor HP yang benar");
  console.log("  3. SQL langsung (hati-hati!): tanya Claude Code untuk generate query DELETE");
}

await prisma.$disconnect();
