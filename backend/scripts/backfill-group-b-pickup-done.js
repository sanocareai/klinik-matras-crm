// PERBAIKAN MASSAL — "Group B" dari audit 6 September 2026: order yang
// status-nya SUDAH READY/SHIPPING (di-override manual), TAPI unit-nya masih
// AWAITING_PICKUP (belum pernah tercatat diambil sama sekali). Kelompok ini
// SENGAJA dibiarkan dulu di backfill-missing-delivery-jobs.js (butuh
// keputusan manusia — apakah pickup memang sudah terjadi tapi tidak
// tercatat, atau order-nya salah didorong maju).
//
// Dikonfirmasi owner 6 September 2026 (kartu Cst Ap/RES-03092026-015 di
// Route Planner memicu audit ulang): "Anggap semua pickup sudah terjadi,
// selesaikan semua" — jadi script ini menganggap SEMUA 12 order di daftar
// ini pickup-nya SUDAH kejadian di lapangan, cuma tidak sempat dicatat di
// sistem (konsisten dengan catatan CLAUDE.md §19: sistem masih baru, job
// assign lama tidak selalu tercatat).
//
// Per order: unit AWAITING_PICKUP -> READY_FOR_DELIVERY, suggestDeliveryJob()
// untuk bikin/gabung job Pengiriman, LALU tutup job Pengambilan yang masih
// aktif (kalau ada — beberapa order lama malah tidak punya job Armada sama
// sekali, itu wajar, dilewati apa adanya) lewat
// selesaikanJobPengambilanTertinggal (SATU-SATUNYA definisi, sama dengan
// yang dipanggil otomatis dari PATCH /orders/:id branch READY).
//
// ⚠️ SENGAJA CUMA MENERIMA DAFTAR orderNumber EKSPLISIT (pola sama dengan
// backfill-missing-delivery-jobs.js) — BUKAN sapuan otomatis, supaya kalau
// suatu saat ada order BARU dengan pola sama, itu di-review dulu sebagai
// kasus baru, bukan otomatis kena backfill ini.
//
// PEMAKAIAN (dry-run dulu, JANGAN langsung --apply):
//   docker compose exec backend node scripts/backfill-group-b-pickup-done.js RES-01092026-002 ...
//   docker compose exec backend node scripts/backfill-group-b-pickup-done.js RES-01092026-002 --apply

import { prisma } from "../src/db.js";
import { suggestDeliveryJob } from "../src/services/deliveryHandoff.js";
import { selesaikanJobPengambilanTertinggal } from "../src/services/orderStatusSync.js";

const APPLY = process.argv.includes("--apply");
const orderNumbers = process.argv.slice(2).filter((a) => a !== "--apply");

if (orderNumbers.length === 0) {
  console.error("Pemakaian: node scripts/backfill-group-b-pickup-done.js <orderNumber...> [--apply]");
  process.exit(1);
}

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY (menulis ke database)" : "DRY-RUN (cuma pratinjau)"}\n`);

  for (const orderNumber of orderNumbers) {
    const order = await prisma.order.findUnique({
      where: { orderNumber },
      select: { id: true, status: true, category: true },
    });
    if (!order) {
      console.log(`${orderNumber}: TIDAK DITEMUKAN — dilewati.`);
      continue;
    }

    const units = await prisma.unit.findMany({
      where: { orderId: order.id, status: { not: "CANCELLED" } },
      select: { id: true, unitCode: true, status: true },
    });

    const unitAneh = units.find((u) => u.status !== "AWAITING_PICKUP" && !["READY_FOR_DELIVERY", "READY_ON_CUSTOMER_HOLD"].includes(u.status));
    if (unitAneh) {
      console.log(`${orderNumber}: DILEWATI — unit ${unitAneh.unitCode} berstatus ${unitAneh.status} (di luar cakupan script ini), butuh tinjauan manual dulu.`);
      continue;
    }

    const perluDidorong = units.filter((u) => u.status === "AWAITING_PICKUP");
    console.log(`${orderNumber} (${order.status}): ${units.length} unit — ${perluDidorong.length} didorong AWAITING_PICKUP -> READY_FOR_DELIVERY, lalu suggestDeliveryJob() + tutup job Pengambilan nyangkut.`);

    if (!APPLY) continue;

    await prisma.$transaction(async (tx) => {
      if (perluDidorong.length > 0) {
        await tx.unit.updateMany({
          where: { id: { in: perluDidorong.map((u) => u.id) } },
          data: { status: "READY_FOR_DELIVERY" },
        });
      }
      for (const u of units) await suggestDeliveryJob(tx, u.id);
      await selesaikanJobPengambilanTertinggal(tx, order.id);
    });
  }

  if (!APPLY) console.log("\nJalankan ulang dengan --apply untuk benar-benar menulis + membuat job Pengiriman + menutup job Pengambilan.");
  else console.log("\nSelesai.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
