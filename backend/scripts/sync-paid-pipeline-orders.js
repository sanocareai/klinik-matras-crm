// Backfill SEKALI: sebelum fix di routes/customers.js (PATCH /:id), tahap
// pipeline "Paid" dan Order.paymentStatus adalah 2 field independen — sales
// bisa saja sudah menandai pelanggan "Paid" TANPA order-nya ikut ditandai
// Lunas, jadi badge order tetap tampil "Belum Bayar" walau pipeline sudah
// "Paid" (bikin bingung berulang di lapangan). Fix di route hanya berlaku
// untuk PERUBAHAN BARU sejak sekarang — script ini merapikan data LAMA yang
// sudah kadung PAID sebelum fix itu ada.
//
// DEFAULT = dry-run (tidak mengubah apa pun), pakai `--apply` untuk benar-benar
// menerapkan. Aman dijalankan berkali-kali (idempotent — order yang sudah
// LUNAS dilewati).
//
//   node backend/scripts/sync-paid-pipeline-orders.js            (pratinjau)
//   node backend/scripts/sync-paid-pipeline-orders.js --apply    (terapkan)

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

async function main() {
  console.log(APPLY
    ? "MODE: --apply → DATA AKAN DIUBAH\n"
    : "MODE: PRATINJAU (dry-run) → tidak ada data yang diubah.\n       Jalankan ulang dengan --apply untuk menerapkan.\n");

  const orders = await prisma.order.findMany({
    where: {
      status: { not: "CANCELLED" },
      paymentStatus: { not: "LUNAS" },
      customer: { pipelineStage: "PAID" },
    },
    select: { id: true, orderNumber: true, paymentStatus: true, customer: { select: { id: true, name: true, phone: true } } },
  });

  console.log(`Ditemukan ${orders.length} order milik pelanggan tahap "Paid" yang belum Lunas:\n`);
  for (const o of orders) {
    console.log(`  - ${o.orderNumber || o.id} (${o.customer.name || o.customer.phone}) — status pembayaran sekarang: ${o.paymentStatus}`);
  }

  if (!orders.length) {
    console.log("\nTidak ada yang perlu diperbaiki. Selesai.");
    return;
  }

  if (!APPLY) {
    console.log(`\nPratinjau selesai. Jalankan dengan --apply untuk menandai ${orders.length} order ini LUNAS.`);
    return;
  }

  const result = await prisma.order.updateMany({
    where: { id: { in: orders.map((o) => o.id) } },
    data: { paymentStatus: "LUNAS" },
  });
  console.log(`\n${result.count} order berhasil ditandai LUNAS.`);
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
