// Script cleanup: fix customer dengan phone LID yang tersimpan salah
// Untuk setiap customer LID:
//   - Kalau ada customer lain dengan nama sama + phone valid → MERGE (pindahkan data, hapus LID)
//   - Kalau tidak ada pasangan → null-kan phone (lebih baik kosong daripada LID salah)
//
// Jalankan: docker compose exec backend node scripts/fix-lid-customers.js

import { prisma } from "../src/db.js";
import { isLidLikePhone } from "../src/services/wahaClient.js";

// Nomor valid Indonesia: 62 + 8-11 digit
function isValidPhone(phone) {
  return phone && /^62\d{8,11}$/.test(phone);
}

// Deteksi LID memakai predikat KANONIK dari wahaClient.js — jangan bikin versi
// sendiri di sini. Dulu script ini punya salinannya dengan ambang BEDA
// (>=10 digit) dari yang dipakai jalur kirim (>13 digit), jadi "bersih menurut
// script" belum tentu "aman menurut jalur kirim".
//
// Tambahan khusus script ini: kolom Customer.phone seharusnya nomor POLOS
// (tanpa @domain). Kalau masih ada "@" apa pun, itu data kotor yang perlu
// dibereskan — jadi di sini "@" apa saja dihitung mencurigakan, sementara
// isLidLikePhone() sengaja mempercayai domain non-@lid (karena di jalur kirim
// @g.us grup itu sah).
function isLidPhone(phone) {
  if (!phone) return false;
  if (phone.includes("@")) return true;
  return isLidLikePhone(phone);
}

async function main() {
  console.log("=== Fix LID Customers ===\n");

  const all = await prisma.customer.findMany({
    include: {
      conversations: true,
      orders:        { select: { id: true } },
      notes:         { select: { id: true } },
    },
  });

  const lidCustomers   = all.filter(c => isLidPhone(c.phone));
  const validCustomers = all.filter(c => isValidPhone(c.phone));

  if (lidCustomers.length === 0) {
    console.log("✅ Tidak ada customer LID yang mencurigakan. Database sudah bersih.");
    return;
  }

  console.log(`Ditemukan ${lidCustomers.length} customer dengan phone LID:\n`);

  let merged = 0;
  let nulled = 0;

  for (const lid of lidCustomers) {
    console.log(`Customer  : ${lid.name || "(tanpa nama)"} | phone LID: ${lid.phone}`);
    console.log(`Data      : ${lid.conversations.length} percakapan | ${lid.orders.length} order | ${lid.notes.length} catatan`);

    // Cari customer dengan nomor valid yang namanya sama persis (case-insensitive)
    const nameLower = (lid.name || "").toLowerCase().trim();
    const match = nameLower
      ? validCustomers.find(c =>
          c.id !== lid.id &&
          (c.name || "").toLowerCase().trim() === nameLower
        )
      : null;

    if (match) {
      console.log(`→ Pasangan ditemukan: ${match.name} | phone: ${match.phone} — merge...`);

      // Pindahkan semua conversation ke customer yang valid
      if (lid.conversations.length > 0) {
        await prisma.conversation.updateMany({
          where: { customerId: lid.id },
          data:  { customerId: match.id },
        });
        console.log(`  ✓ ${lid.conversations.length} percakapan dipindahkan`);
      }

      // Pindahkan semua order
      if (lid.orders.length > 0) {
        await prisma.order.updateMany({
          where: { customerId: lid.id },
          data:  { customerId: match.id },
        });
        console.log(`  ✓ ${lid.orders.length} order dipindahkan`);
      }

      // Pindahkan semua catatan
      if (lid.notes.length > 0) {
        await prisma.note.updateMany({
          where: { customerId: lid.id },
          data:  { customerId: match.id },
        });
        console.log(`  ✓ ${lid.notes.length} catatan dipindahkan`);
      }

      // Salin field data penting yang masih kosong di customer valid
      const patch = {};
      if (!match.city           && lid.city)           patch.city           = lid.city;
      if (!match.email          && lid.email)           patch.email          = lid.email;
      if (!match.assignedSalesId && lid.assignedSalesId) patch.assignedSalesId = lid.assignedSalesId;
      if (!match.tags?.length   && lid.tags?.length)    patch.tags           = lid.tags;
      if (lid.pipelineStage !== "LEAD" && match.pipelineStage === "LEAD") {
        patch.pipelineStage = lid.pipelineStage;
      }

      if (Object.keys(patch).length > 0) {
        await prisma.customer.update({ where: { id: match.id }, data: patch });
        console.log(`  ✓ Data customer diperbarui: ${Object.keys(patch).join(", ")}`);
      }

      // Hapus customer LID
      await prisma.customer.delete({ where: { id: lid.id } });
      console.log(`  ✓ Customer LID dihapus`);
      merged++;

    } else {
      // Tidak ada pasangan — null-kan phone supaya tidak kirim ke LID ID yang salah
      await prisma.customer.update({ where: { id: lid.id }, data: { phone: null } });
      console.log(`→ Tidak ada pasangan — phone di-reset ke null (data tetap ada)`);
      console.log(`  Perbarui nomor manual di CRM setelah customer kirim pesan lagi`);
      nulled++;
    }

    console.log();
  }

  console.log("=== RINGKASAN ===");
  console.log(`✅ Merge berhasil  : ${merged} customer`);
  console.log(`⚠️  Phone di-null  : ${nulled} customer`);

  if (nulled > 0) {
    console.log("\nUntuk customer yang di-null:");
    console.log("  Saat customer kirim pesan lagi dari WA, sistem akan otomatis buat customer baru.");
    console.log("  Kalau customer punya riwayat order/catatan penting, merge manual via Prisma Studio.");
  }
}

main()
  .catch(e => { console.error("Error:", e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
