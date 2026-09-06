// PERBAIKAN MASSAL: order READY/SHIPPING (status di-override manual lewat
// dropdown D-086) yang unit-nya TIDAK PERNAH dapat job DELIVERY sama sekali
// — akar masalah SAMA dengan fix-stuck-delivery-unit.js (suggestDeliveryJob
// cuma terpicu dari jalur produksi asli, bukan dari override status manual;
// SUDAH diperbaiki di PATCH /orders/:id untuk kasus BARU, script ini untuk
// backlog kasus LAMA sebelum perbaikan itu ada).
//
// BEDA dari fix-stuck-delivery-unit.js: script itu untuk unit yang KELIRU
// ter-DELIVERED (perlu ditarik balik ke READY_FOR_DELIVERY dulu). Script
// INI untuk unit yang statusnya MASIH DI TENGAH jalan (RECEIVED dst, belum
// pernah DELIVERED sama sekali) tapi order-nya sudah READY/SHIPPING —
// tinggal didorong maju ke READY_FOR_DELIVERY + dibuatkan job.
//
// ⚠️ SENGAJA CUMA MENERIMA DAFTAR orderNumber EKSPLISIT (bukan sapuan
// otomatis "semua order READY") — audit 6 September 2026 menemukan 22 order
// begini, TAPI terbagi 2 kelompok yang beda risiko:
//   - Unit sudah RECEIVED (fisik SUDAH ada di bengkel) — aman didorong maju,
//     ini yang ditangani script ini.
//   - Unit MASIH AwaitingPickup (belum pernah diambil sama sekali per
//     catatan sistem) — TIDAK ditangani di sini, order begini butuh
//     tinjauan manusia dulu (order-nya salah didorong maju, ATAU pickup-nya
//     memang sudah kejadian tapi tidak pernah tercatat) sebelum diputuskan
//     mau dibetulkan ke arah mana.
//
// PEMAKAIAN (dry-run dulu, JANGAN langsung --apply):
//   docker compose exec backend node scripts/backfill-missing-delivery-jobs.js RES-02092026-010 NEW-18082026-010 ...
//   docker compose exec backend node scripts/backfill-missing-delivery-jobs.js RES-02092026-010 --apply
//
// Guard: MENOLAK order yang punya unit di luar {RECEIVED, IN_PRODUCTION,
// READY_FOR_DELIVERY, READY_ON_CUSTOMER_HOLD} — supaya tidak sengaja
// dipakai untuk order kelompok AwaitingPickup di atas lewat baris perintah.

import { prisma } from "../src/db.js";
import { suggestDeliveryJob } from "../src/services/deliveryHandoff.js";

const APPLY = process.argv.includes("--apply");
const orderNumbers = process.argv.slice(2).filter((a) => a !== "--apply");

const STATUS_AMAN_DIDORONG = ["RECEIVED", "IN_PRODUCTION", "READY_FOR_DELIVERY", "READY_ON_CUSTOMER_HOLD"];

if (orderNumbers.length === 0) {
  console.error("Pemakaian: node scripts/backfill-missing-delivery-jobs.js <orderNumber...> [--apply]");
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

    const unitAneh = units.find((u) => !STATUS_AMAN_DIDORONG.includes(u.status));
    if (unitAneh) {
      console.log(`${orderNumber}: DILEWATI — unit ${unitAneh.unitCode} berstatus ${unitAneh.status} (di luar daftar aman), butuh tinjauan manual dulu.`);
      continue;
    }

    const perluDidorong = units.filter((u) => !["READY_FOR_DELIVERY", "READY_ON_CUSTOMER_HOLD"].includes(u.status));
    console.log(`${orderNumber} (${order.status}): ${units.length} unit — ${perluDidorong.length} didorong ke READY_FOR_DELIVERY, lalu suggestDeliveryJob() untuk semua ${units.length}.`);

    if (!APPLY) continue;

    await prisma.$transaction(async (tx) => {
      if (perluDidorong.length > 0) {
        await tx.unit.updateMany({
          where: { id: { in: perluDidorong.map((u) => u.id) } },
          data: { status: "READY_FOR_DELIVERY" },
        });
      }
      for (const u of units) await suggestDeliveryJob(tx, u.id);
    });
  }

  if (!APPLY) console.log("\nJalankan ulang dengan --apply untuk benar-benar menulis + membuat job Pengiriman.");
  else console.log("\nSelesai.");
}

main()
  .catch((err) => {
    console.error("Gagal:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
