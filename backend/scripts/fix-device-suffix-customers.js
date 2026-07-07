// Script cleanup: fix customer dengan phone yang mengandung device suffix ":NN"
// (contoh: "6285697620076:43" — format WhatsApp multi-device yang tidak di-strip saat disimpan)
//
// Untuk setiap customer ber-suffix:
//   - Hitung canonical phone = strip ":NN" bagian belakang
//   - Kalau ada customer lain dengan canonical phone → MERGE (pindahkan data, hapus duplikat)
//   - Kalau tidak ada pasangan → update phone jadi canonical langsung (tidak delete)
//
// Jalankan: docker compose exec backend node scripts/fix-device-suffix-customers.js

import { prisma } from "../src/db.js";

// Cek apakah nomor telepon mengandung device suffix ":NN"
function hasDeviceSuffix(phone) {
  return phone && /:\d+/.test(phone);
}

// Strip device suffix: "6285697620076:43" → "6285697620076"
function stripSuffix(phone) {
  return phone ? phone.split(":")[0] : phone;
}

async function main() {
  console.log("=== Fix Device Suffix Customers ===\n");

  const all = await prisma.customer.findMany({
    include: {
      conversations: true,
      orders:        { select: { id: true } },
      notes:         { select: { id: true } },
    },
  });

  const suffixCustomers = all.filter(c => hasDeviceSuffix(c.phone));
  const cleanCustomers  = all.filter(c => c.phone && !hasDeviceSuffix(c.phone));

  if (suffixCustomers.length === 0) {
    console.log("✅ Tidak ada customer dengan device suffix. Database sudah bersih.");
    return;
  }

  console.log(`Ditemukan ${suffixCustomers.length} customer dengan phone ber-suffix ":NN":\n`);

  let merged  = 0;
  let stripped = 0;

  for (const dup of suffixCustomers) {
    const canonical = stripSuffix(dup.phone);
    console.log(`Customer  : ${dup.name || "(tanpa nama)"} | phone: ${dup.phone} → canonical: ${canonical}`);
    console.log(`Data      : ${dup.conversations.length} percakapan | ${dup.orders.length} order | ${dup.notes.length} catatan`);

    // Cari customer dengan canonical phone
    const match = cleanCustomers.find(c => c.id !== dup.id && c.phone === canonical);

    if (match) {
      console.log(`→ Pasangan ditemukan: ${match.name || "(tanpa nama)"} | phone: ${match.phone} — merge...`);

      // Pindahkan semua conversation
      if (dup.conversations.length > 0) {
        await prisma.conversation.updateMany({
          where: { customerId: dup.id },
          data:  { customerId: match.id },
        });
        console.log(`  ✓ ${dup.conversations.length} percakapan dipindahkan`);
      }

      // Pindahkan semua order
      if (dup.orders.length > 0) {
        await prisma.order.updateMany({
          where: { customerId: dup.id },
          data:  { customerId: match.id },
        });
        console.log(`  ✓ ${dup.orders.length} order dipindahkan`);
      }

      // Pindahkan semua catatan
      if (dup.notes.length > 0) {
        await prisma.note.updateMany({
          where: { customerId: dup.id },
          data:  { customerId: match.id },
        });
        console.log(`  ✓ ${dup.notes.length} catatan dipindahkan`);
      }

      // Update ClickEvent yang terkait
      await prisma.clickEvent.updateMany({
        where: { matchedCustomerId: dup.id },
        data:  { matchedCustomerId: match.id },
      }).catch(() => {});

      // Salin field yang masih kosong di customer canonical
      const patch = {};
      if (!match.city            && dup.city)            patch.city            = dup.city;
      if (!match.email           && dup.email)           patch.email           = dup.email;
      if (!match.assignedSalesId && dup.assignedSalesId) patch.assignedSalesId = dup.assignedSalesId;
      if (!match.tags?.length    && dup.tags?.length)    patch.tags            = dup.tags;
      if (!match.name            && dup.name)            patch.name            = dup.name;
      if (dup.pipelineStage !== "LEAD" && match.pipelineStage === "LEAD") {
        patch.pipelineStage = dup.pipelineStage;
      }
      if (dup.customerType !== "END_USER" && match.customerType === "END_USER") {
        patch.customerType = dup.customerType;
      }

      if (Object.keys(patch).length > 0) {
        await prisma.customer.update({ where: { id: match.id }, data: patch });
        console.log(`  ✓ Field disalin ke canonical: ${Object.keys(patch).join(", ")}`);
      }

      // Hapus customer duplikat (yang ber-suffix)
      await prisma.customer.delete({ where: { id: dup.id } });
      console.log(`  ✓ Customer duplikat dihapus`);
      merged++;

    } else {
      // Tidak ada pasangan — update phone ke canonical langsung (tidak delete, data tetap)
      await prisma.customer.update({
        where: { id: dup.id },
        data:  { phone: canonical },
      });
      console.log(`→ Tidak ada pasangan — phone diupdate: ${dup.phone} → ${canonical}`);
      stripped++;
    }

    console.log();
  }

  console.log("=== RINGKASAN ===");
  console.log(`✅ Merge berhasil   : ${merged} customer (duplikat dihapus, data dipindah ke canonical)`);
  console.log(`✅ Phone di-strip   : ${stripped} customer (tidak ada pasangan, phone langsung dibersihkan)`);

  if (merged + stripped > 0) {
    console.log("\nLangkah berikutnya:");
    console.log("  Coba tombol 'Sinkronisasi Riwayat Chat' di Pengaturan →");
    console.log("  Sekarang fetchChatHistory akan query nomor yang benar → pesan lama akan masuk.");
  }
}

main()
  .catch(e => { console.error("Error:", e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
