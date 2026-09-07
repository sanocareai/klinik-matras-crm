// Script satu-off: tandai Customer.isInternalStaff=true untuk nomor WA
// PRIBADI tim sendiri yang sudah TERLANJUR punya Customer record (dibuat
// SEBELUM utils/staffDirectory.js#isInternalStaffPhone ada) — supaya
// GET /conversations (routes/conversations.js) bisa mengecualikan mereka
// dari Inbox utama, dan tab "Kontak Tim" bisa menampilkan mereka terpisah.
// Lihat catatan panjang di schema.prisma model Customer.
//
// Sumber nomor: SATU-SATUNYA sumber kebenaran yang sudah ada —
// data/settings.json > slaAlert.salesPhoneDirectory + env
// BACKUP_NOTIFY_PHONE (SAMA persis dgn isInternalStaffPhone()) — supaya
// tidak ada directory kedua yang perlu di-maintain terpisah.
//
// PRATINJAU adalah DEFAULT — script ini MENGUBAH VISIBILITAS percakapan di
// Inbox seluruh tim, bukan sekadar kosmetik. Tanpa flag apa pun cuma
// MELAPORKAN rencana; harus eksplisit `--apply` untuk benar-benar menandai.
//
// Jalankan:
//   docker compose exec backend node scripts/mark-internal-staff-customers.js
//   docker compose exec backend node scripts/mark-internal-staff-customers.js --apply

import { prisma } from "../src/db.js";
import { isInternalStaffPhone } from "../src/utils/staffDirectory.js";

const APPLY = process.argv.includes("--apply");

async function main() {
  console.log("=== Tandai Customer Internal Staff ===");
  console.log(APPLY
    ? "MODE: --apply -> DATA AKAN DIUBAH\n"
    : "MODE: PRATINJAU (dry-run) -> tidak ada data yang diubah.\n       Jalankan ulang dengan --apply untuk menerapkan.\n");

  const all = await prisma.customer.findMany({
    select: { id: true, name: true, phone: true, isInternalStaff: true },
  });

  const cocok = all.filter((c) => c.phone && isInternalStaffPhone(c.phone));
  const perluDiubah = cocok.filter((c) => !c.isInternalStaff);
  const sudahBenar = cocok.filter((c) => c.isInternalStaff);

  console.log(`Ditemukan ${cocok.length} Customer dengan nomor staf internal:`);
  for (const c of cocok) {
    const status = c.isInternalStaff ? "(sudah ditandai)" : "(BELUM ditandai — akan diubah)";
    console.log(`  - [${c.id}] ${c.name || "(tanpa nama)"} — ${c.phone} ${status}`);
  }
  console.log(`\n${perluDiubah.length} baris perlu diubah, ${sudahBenar.length} sudah benar.`);

  if (!APPLY) {
    console.log("\nPratinjau selesai. Tidak ada data yang diubah.");
    return;
  }

  if (perluDiubah.length === 0) {
    console.log("\nTidak ada yang perlu diubah.");
    return;
  }

  await prisma.customer.updateMany({
    where: { id: { in: perluDiubah.map((c) => c.id) } },
    data: { isInternalStaff: true },
  });
  console.log(`\n${perluDiubah.length} Customer berhasil ditandai isInternalStaff=true.`);
}

main()
  .catch((err) => { console.error("Gagal:", err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
