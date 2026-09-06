// PERBAIKAN per-ORDER: unit yang ter-DELIVERED KELIRU gara-gara override
// status manual (D-086 dropdown Route Planner/Jadwal & Penugasan/POD)
// sempat "dicoba" ke Terkirim lalu ditarik balik — Unit.status ikut ter-
// DELIVERED (kaskade PATCH /orders/:id), TIDAK PERNAH otomatis kembali
// walau Order.status sudah ditarik balik ke tahap sebelumnya. Akibatnya
// job Pengiriman (DELIVERY) tidak pernah dibuat, karena suggestDeliveryJob
// cuma terpicu dari unit yang jadi READY_FOR_DELIVERY (bukan DELIVERED).
//
// Kasus nyata pertama (6 September 2026): order Ichas RES-03092026-014 —
// Order.status ditarik balik ke READY oleh admin, tapi Unit.status masih
// DELIVERED dari percobaan sebelumnya. Root cause di PATCH /orders/:id
// SUDAH DIPERBAIKI (cabang `status === "READY"` sekarang memanggil
// suggestDeliveryJob) — TAPI itu cuma mencegah kasus BARU, tidak
// membetulkan unit yang SUDAH kadung salah sebelum perbaikan itu ada.
// Script ini untuk kasus lama seperti itu — dijalankan MANUAL per order,
// BUKAN sapuan otomatis ke semua unit DELIVERED (kebanyakan memang benar
// sudah terkirim, jangan disentuh).
//
// PEMAKAIAN (dry-run dulu, JANGAN langsung --apply):
//   docker compose exec backend node scripts/fix-stuck-delivery-unit.js RES-03092026-014
//   docker compose exec backend node scripts/fix-stuck-delivery-unit.js RES-03092026-014 --apply
//
// Yang dilakukan --apply: unit order ini yang statusnya DELIVERED diubah
// jadi READY_FOR_DELIVERY, lalu suggestDeliveryJob() dipanggil (idempotent
// — skip kalau unit itu sudah pernah masuk job DELIVERY manapun).

import { prisma } from "../src/db.js";
import { suggestDeliveryJob } from "../src/services/deliveryHandoff.js";

const APPLY = process.argv.includes("--apply");
const orderNumber = process.argv[2];

if (!orderNumber || orderNumber === "--apply") {
  console.error("Pemakaian: node scripts/fix-stuck-delivery-unit.js <orderNumber> [--apply]");
  process.exit(1);
}

async function main() {
  const order = await prisma.order.findUnique({
    where: { orderNumber },
    select: { id: true, orderNumber: true, status: true, statusLocked: true, category: true },
  });
  if (!order) {
    console.error(`Order ${orderNumber} tidak ditemukan.`);
    process.exit(1);
  }

  const units = await prisma.unit.findMany({
    where: { orderId: order.id, status: "DELIVERED" },
    select: { id: true, unitCode: true, status: true },
  });

  console.log(`Order: ${order.orderNumber} — status: ${order.status} (locked: ${order.statusLocked})`);
  console.log(`Mode: ${APPLY ? "APPLY (menulis ke database)" : "DRY-RUN (cuma pratinjau)"}`);

  if (units.length === 0) {
    console.log("Tidak ada unit berstatus DELIVERED di order ini — tidak ada yang perlu diperbaiki.");
    return;
  }

  console.log(`\nUnit yang akan diubah DELIVERED -> READY_FOR_DELIVERY:`);
  units.forEach((u) => console.log(`  - ${u.unitCode}`));

  if (!APPLY) {
    console.log("\nJalankan ulang dengan --apply untuk benar-benar menulis + membuat job Pengiriman.");
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.unit.updateMany({
      where: { id: { in: units.map((u) => u.id) } },
      data: { status: "READY_FOR_DELIVERY" },
    });
    for (const u of units) await suggestDeliveryJob(tx, u.id);
  });

  console.log("\nSelesai. Cek Route Planner/Jadwal & Penugasan tab Pengiriman — job baru seharusnya sudah muncul.");
}

main()
  .catch((err) => {
    console.error("Gagal:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
