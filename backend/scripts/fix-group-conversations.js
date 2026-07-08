/**
 * Script cleanup: tandai percakapan grup yang tersimpan salah sebagai customer individu.
 *
 * Latar belakang:
 * Sebelum ada deteksi @g.us, pesan dari grup WhatsApp diproses seperti pesan individual:
 * CRM membuat Customer baru dengan phone = nomor group ID (bukan nomor HP asli),
 * atau bahkan phone = null (untuk kasus tertentu seperti "SANO DRIVETHRU").
 *
 * Script ini:
 * 1. Ambil SEMUA customer (termasuk yang phone-nya null)
 * 2. Kandidat grup = phone === null ATAU phone tidak cocok format HP Indonesia
 * 3. Update conversation jadi type=GROUP, groupJid (dari phone atau placeholder), customerId=null
 * 4. Hapus customer palsu (kalau tidak ada order/catatan)
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

// Pola HP Indonesia yang valid (setelah normalisasi, tanpa + atau 0 di depan)
// Contoh valid: 6281234567890
const VALID_PHONE_REGEX = /^62\d{8,12}$/;

async function main() {
  // Ambil SEMUA customer — termasuk yang phone-nya null
  const allCustomers = await prisma.customer.findMany({
    include: {
      conversations: true,
      orders:        { take: 1 },
      notes:         { take: 1 },
    },
  });

  // Kandidat grup: phone null ATAU tidak cocok format HP Indonesia
  const candidates = allCustomers.filter((c) => {
    if (c.phone === null || c.phone === undefined) return true; // phone null = mencurigakan
    if (VALID_PHONE_REGEX.test(c.phone)) return false;          // valid → skip
    return true;                                                  // phone tidak valid
  });

  if (candidates.length === 0) {
    console.log("Tidak ditemukan customer mencurigakan. Tidak ada yang perlu dibersihkan.");
    await prisma.$disconnect();
    return;
  }

  console.log(`Ditemukan ${candidates.length} customer mencurigakan (phone null atau tidak valid):\n`);

  let fixed = 0;
  let skipped = 0;

  for (const c of candidates) {
    const hasOrders = c.orders.length > 0;
    const hasNotes  = c.notes.length > 0;

    // Tentukan groupJid:
    // - Kalau ada phone (tapi bukan format valid HP) → pakai phone@g.us seperti sebelumnya
    // - Kalau phone null → buat placeholder yang jelas, dan log warning
    let groupJid;
    let groupJidWarning = false;

    if (c.phone) {
      groupJid = `${c.phone}@g.us`;
    } else {
      groupJid = `unknown-${c.id}@g.us`;
      groupJidWarning = true;
    }

    const groupName = c.name || groupJid.split("@")[0];

    console.log(`  Customer: ${c.id} | phone: ${c.phone ?? "(null)"} | name: ${c.name || "-"}`);
    console.log(`    groupJid: ${groupJid}${groupJidWarning ? " ⚠ PLACEHOLDER (phone asli tidak diketahui)" : ""}`);
    console.log(`    orders: ${c.orders.length} | notes: ${c.notes.length} | convs: ${c.conversations.length}`);

    // Safety: kalau ada order/catatan, mungkin ini customer nyata dengan nomor tidak standar
    if (hasOrders || hasNotes) {
      console.log(`    ⚠ SKIP — ada order/catatan, periksa manual.\n`);
      skipped++;
      continue;
    }

    if (!DRY_RUN) {
      for (const conv of c.conversations) {
        await prisma.conversation.update({
          where: { id: conv.id },
          data:  { type: "GROUP", groupJid, groupName, customerId: null },
        });
      }

      await prisma.customer.delete({ where: { id: c.id } });
      console.log(`    ✓ FIXED — ${c.conversations.length} conversation → GROUP, customer dihapus.\n`);
    } else {
      console.log(`    [DRY-RUN] Akan diubah: ${c.conversations.length} conv → GROUP, customer akan dihapus.\n`);
    }
    fixed++;
  }

  console.log(`\nSelesai. ${DRY_RUN ? "[DRY-RUN] Akan " : ""}Difix: ${fixed} | Dilewati: ${skipped}`);
  if (skipped > 0) {
    console.log("⚠ Customer yang dilewati perlu diperiksa manual (ada order/catatan terikat).");
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
