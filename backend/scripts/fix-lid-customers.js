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

// PRATINJAU adalah DEFAULT. Script ini MENGHAPUS record Customer di jalur
// merge — di production itu tidak bisa dibatalkan tanpa restore backup. Jadi
// tanpa flag apa pun script hanya MELAPORKAN rencananya; harus eksplisit
// `--apply` untuk benar-benar mengubah data.
const APPLY = process.argv.includes("--apply");

async function main() {
  console.log("=== Fix LID Customers ===");
  console.log(APPLY
    ? "MODE: --apply → DATA AKAN DIUBAH\n"
    : "MODE: PRATINJAU (dry-run) → tidak ada data yang diubah.\n       Jalankan ulang dengan --apply untuk menerapkan.\n");

  const all = await prisma.customer.findMany({
    include: {
      conversations: true,
      orders:              { select: { id: true } },
      notes:               { select: { id: true } },
      pipelineTransitions: { select: { id: true } },
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
    console.log(`Data      : ${lid.conversations.length} percakapan | ${lid.orders.length} order | ${lid.notes.length} catatan | ${lid.pipelineTransitions.length} riwayat stage`);

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

      // Salin field data penting yang masih kosong di customer valid
      const patch = {};
      if (!match.city           && lid.city)           patch.city           = lid.city;
      if (!match.email          && lid.email)           patch.email          = lid.email;
      if (!match.assignedSalesId && lid.assignedSalesId) patch.assignedSalesId = lid.assignedSalesId;
      if (!match.tags?.length   && lid.tags?.length)    patch.tags           = lid.tags;
      if (lid.pipelineStage !== "LEAD" && match.pipelineStage === "LEAD") {
        patch.pipelineStage = lid.pipelineStage;
      }

      const rencana = [
        lid.conversations.length       ? `${lid.conversations.length} percakapan`       : null,
        lid.orders.length              ? `${lid.orders.length} order`                   : null,
        lid.notes.length               ? `${lid.notes.length} catatan`                  : null,
        lid.pipelineTransitions.length ? `${lid.pipelineTransitions.length} riwayat stage` : null,
      ].filter(Boolean);
      console.log(`  · pindahkan: ${rencana.length ? rencana.join(", ") : "(tidak ada relasi)"}`);
      if (Object.keys(patch).length) console.log(`  · isi field kosong: ${Object.keys(patch).join(", ")}`);
      console.log(`  · HAPUS customer LID ${lid.id}`);

      if (APPLY) {
        // SATU TRANSAKSI. Sebelumnya ini 5 write terpisah — kalau proses mati
        // di tengah, data setengah pindah dan customer LID masih ada (atau
        // lebih buruk: relasi sudah pindah tapi delete gagal).
        await prisma.$transaction(async (tx) => {
          // ⚠️ pipeline_transitions WAJIB dipindahkan SEBELUM delete.
          // FK-nya onDelete: CASCADE (beda dari Order/Note yang RESTRICT),
          // jadi customer.delete() akan MENGHAPUS riwayat stage tanpa error
          // dan tanpa peringatan — data hilang diam-diam. Order/Note aman
          // karena RESTRICT (delete-nya akan gagal keras kalau terlewat),
          // tabel ini TIDAK punya jaring itu.
          if (lid.pipelineTransitions.length > 0) {
            await tx.pipelineTransition.updateMany({
              where: { customerId: lid.id },
              data:  { customerId: match.id },
            });
          }
          if (lid.conversations.length > 0) {
            await tx.conversation.updateMany({ where: { customerId: lid.id }, data: { customerId: match.id } });
          }
          if (lid.orders.length > 0) {
            await tx.order.updateMany({ where: { customerId: lid.id }, data: { customerId: match.id } });
          }
          if (lid.notes.length > 0) {
            await tx.note.updateMany({ where: { customerId: lid.id }, data: { customerId: match.id } });
          }
          if (Object.keys(patch).length > 0) {
            await tx.customer.update({ where: { id: match.id }, data: patch });
          }
          await tx.customer.delete({ where: { id: lid.id } });
        });
        console.log(`  ✓ merge selesai (1 transaksi)`);
      }
      merged++;

    } else {
      // Tidak ada pasangan — null-kan phone supaya tidak kirim ke LID ID yang salah
      console.log(`  · set phone = null (order/catatan/percakapan TETAP)`);
      if (APPLY) {
        await prisma.customer.update({ where: { id: lid.id }, data: { phone: null } });
      }
      console.log(`→ Tidak ada pasangan — phone di-reset ke null (data tetap ada)`);
      console.log(`  Perbarui nomor manual di CRM setelah customer kirim pesan lagi`);
      nulled++;
    }

    console.log();
  }

  console.log("=== RINGKASAN ===");
  console.log(APPLY ? `✅ Merge selesai   : ${merged} customer` : `• Akan di-merge   : ${merged} customer (customer LID DIHAPUS)`);
  console.log(APPLY ? `⚠️  Phone di-null  : ${nulled} customer` : `• Phone akan null : ${nulled} customer`);

  if (nulled > 0) {
    console.log("\nDampak customer yang phone-nya di-null:");
    console.log("  Order/catatan/percakapan TETAP ADA — tidak ada yang dihapus.");
    console.log("  TAPI sales TIDAK BISA membalas chat mereka sampai nomornya terisi lagi");
    console.log("  (UI akan bilang \"Nomor WA pelanggan tidak tersedia\"). Nomor terisi");
    console.log("  otomatis begitu customer kirim pesan lagi dan WAHA berhasil resolve.");
  }

  if (!APPLY) {
    console.log("\n──────────────────────────────────────────────────────────────");
    console.log("PRATINJAU — TIDAK ADA DATA YANG DIUBAH.");
    console.log("Kalau rencana di atas sudah benar, jalankan:");
    console.log("  docker compose exec backend node scripts/fix-lid-customers.js --apply");
    if (merged > 0) {
      console.log("\n⚠️  BACKUP DULU sebelum --apply: jalur merge MENGHAPUS record");
      console.log("   Customer dan itu tidak bisa dibatalkan tanpa restore.");
      console.log("   ./backend/scripts/backup-database.sh");
    }
    console.log("──────────────────────────────────────────────────────────────");
  }
}

main()
  .catch(e => { console.error("Error:", e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
