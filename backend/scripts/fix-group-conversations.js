/**
 * Script cleanup: tandai percakapan grup yang tersimpan salah sebagai customer individu.
 *
 * Latar belakang:
 * Sebelum ada deteksi @g.us, pesan dari grup WhatsApp diproses seperti pesan individual:
 * CRM membuat Customer baru dengan phone = nomor group ID (bukan nomor HP asli),
 * dan Conversation bertipe INDIVIDUAL.
 *
 * Script ini:
 * 1. Cari customer dengan phone yang TIDAK cocok format HP Indonesia (^62\d{8,12}$)
 * 2. Untuk tiap customer "mencurigakan", cek apakah phonenya bisa jadi group ID
 * 3. Update conversation jadi type=GROUP, groupJid=phone@g.us, customerId=null
 * 4. Hapus customer palsu tersebut (tidak ada data order/catatan yang perlu dijaga)
 *
 * Jalankan sekali di VPS setelah migration:
 *   docker compose exec backend node scripts/fix-group-conversations.js
 *
 * Tambah flag --dry-run untuk preview tanpa mengubah data.
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes("--dry-run");

if (DRY_RUN) {
  console.log("=== MODE DRY-RUN: tidak ada data yang diubah ===\n");
}

// Pola HP Indonesia yang valid untuk WhatsApp (setelah normalisasi tanpa +/0 di depan)
// Contoh valid: 6281234567890 (13 digit, mulai 62)
const VALID_PHONE_REGEX = /^62\d{8,12}$/;

async function main() {
  // Ambil semua customer yang phonenya tampak BUKAN nomor HP Indonesia
  const suspectCustomers = await prisma.customer.findMany({
    where: {
      phone: { not: null },
    },
    include: {
      conversations: true,
      orders:        { take: 1 },
      notes:         { take: 1 },
    },
  });

  const groups = suspectCustomers.filter((c) => {
    if (!c.phone) return false;
    // Kalau sudah format valid → skip
    if (VALID_PHONE_REGEX.test(c.phone)) return false;
    return true;
  });

  if (groups.length === 0) {
    console.log("Tidak ditemukan customer mencurigakan. Tidak ada yang perlu dibersihkan.");
    await prisma.$disconnect();
    return;
  }

  console.log(`Ditemukan ${groups.length} customer dengan phone tidak valid:\n`);

  let fixed = 0;
  let skipped = 0;

  for (const c of groups) {
    const groupJid = `${c.phone}@g.us`;
    const hasOrders = c.orders.length > 0;
    const hasNotes  = c.notes.length > 0;

    console.log(`  Customer: ${c.id} | phone: ${c.phone} | name: ${c.name || "-"}`);
    console.log(`    JID: ${groupJid} | orders: ${c.orders.length} | notes: ${c.notes.length} | convs: ${c.conversations.length}`);

    // Hati-hati: kalau ada order/catatan, mungkin ini bukan grup (tapi customer nyata dengan nomor aneh)
    if (hasOrders || hasNotes) {
      console.log(`    ⚠ SKIP — ada order/catatan, mungkin bukan grup. Periksa manual.\n`);
      skipped++;
      continue;
    }

    if (!DRY_RUN) {
      // Update semua conversation customer ini jadi GROUP
      for (const conv of c.conversations) {
        await prisma.conversation.update({
          where: { id: conv.id },
          data: {
            type:       "GROUP",
            groupJid,
            groupName:  c.name || groupJid.split("@")[0],
            customerId: null,
          },
        });
      }

      // Hapus customer palsu (tidak ada order/catatan yang terikat)
      await prisma.customer.delete({ where: { id: c.id } });
      console.log(`    ✓ FIXED — ${c.conversations.length} conversation dipindah ke GROUP, customer dihapus.\n`);
    } else {
      console.log(`    [DRY-RUN] Akan diubah: ${c.conversations.length} conv → GROUP, customer akan dihapus.\n`);
    }
    fixed++;
  }

  console.log(`\nSelesai. ${DRY_RUN ? "[DRY-RUN] Akan " : ""}Difix: ${fixed} | Dilewati: ${skipped}`);
  if (skipped > 0) {
    console.log("⚠ Customer yang dilewati perlu diperiksa manual — mungkin nomor HP tidak standar Indonesia.");
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
