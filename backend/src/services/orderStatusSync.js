// Order.status TURUNAN dari Unit.status (D-006, Integrasi Fase 1) — tidak
// lagi ditulis manual dari form. Aturan agregasi: Order mengikuti unit yang
// PALING TERTINGGAL (weakest link) — Order baru dianggap "Delivered" kalau
// SEMUA unit-nya delivered; satu unit saja masih di produksi, Order tetap
// "Processing". Order TIDAK BOLEH bilang "selesai" padahal ada unit yang
// belum — itulah alasan aturannya weakest-link, bukan mayoritas.
//
// Order.statusLocked (override manual, PATCH /orders/:id) MENANG mutlak —
// kalau true, syncOrderStatus SAMA SEKALI TIDAK menyentuh Order.status,
// walau unit-unitnya terus berubah di belakang layar. Ini supaya keputusan
// manusia (order dibatalkan, dst) tidak diam-diam ditimpa ulang oleh sync.
//
// Pola sinkronisasi ini SAMA dengan recomputeOrderPaymentStatus di
// paymentLedger.js — dipanggil eksplisit dari setiap titik yang menulis
// Unit.status, bukan trigger DB, supaya jejaknya mudah ditelusuri dari kode.

import { prisma } from "../db.js";

// SHIPPING ditambahkan 5 September 2026 (permintaan owner: penanda "sedang
// di jalan diantar", sebelumnya loncat langsung READY->DELIVERED).
const RANK = { PICKUP: 0, PROCESSING: 1, READY: 2, SHIPPING: 3, DELIVERED: 4 };

// UnitStatus -> bucket OrderStatus. CANCELLED unit dikecualikan dari
// agregasi (lihat computeOrderStatus), jadi tidak perlu baris di sini.
const UNIT_TO_ORDER_BUCKET = {
  AWAITING_PICKUP: "PICKUP",
  IN_TRANSIT_IN: "PICKUP",
  RECEIVED: "PROCESSING",
  IN_PRODUCTION: "PROCESSING",
  READY_FOR_DELIVERY: "READY",
  READY_ON_CUSTOMER_HOLD: "READY",
  // IN_TRANSIT_OUT (5 Sep 2026, KOREKSI) — sebelumnya dipetakan ke bucket
  // READY, padahal ini PERSIS unit fisik sedang di jalan diantar driver
  // (job DELIVERY berstatus EN_ROUTE/ARRIVED yang mengubah Unit ke status
  // ini). Sekarang bucket sendiri (SHIPPING), supaya order yang benar-benar
  // sedang dikirim terlihat beda dari yang baru "siap kirim tapi belum ada
  // driver jalan".
  IN_TRANSIT_OUT: "SHIPPING",
  DELIVERED: "DELIVERED",
};

/**
 * Pure function — dites langsung tanpa DB (lihat tests/orderStatusSync.test.js).
 * `units` = array {status, currentStageId}. Return null kalau tidak ada
 * dasar untuk menghitung — pemanggil HARUS membiarkan Order.status apa
 * adanya kalau hasilnya null, bukan menganggap null sebagai "PENDING" atau
 * status lain. Dua kasus null:
 *   1. Semua unit CANCELLED (atau tidak ada unit sama sekali).
 *   2. TIDAK ADA unit yang currentStageId-nya terisi — artinya belum satu
 *      pun unit order ini benar-benar mulai dikerjakan lewat stage engine
 *      (currentStageId cuma diisi startStage(), tidak pernah di Unit
 *      creation — lihat unitStageEngine.js). Ini yang membuat sync AMAN
 *      dideploy ke 199 unit backfill yang belum diadopsi (lihat catatan
 *      "KENYATAAN DATA" di frontend/src/features/bengkel/unitStatus.js) —
 *      Order.status lama mereka TIDAK disentuh sampai benar-benar ada yang
 *      menekan "Mulai Tahap", bukan diam-diam ditimpa di hari deploy.
 */
export function computeOrderStatus(units) {
  const hidup = units.filter((u) => u.status !== "CANCELLED" && u.currentStageId != null);
  if (hidup.length === 0) return null;

  let terlemah = null;
  for (const u of hidup) {
    const bucket = UNIT_TO_ORDER_BUCKET[u.status];
    if (!bucket) continue;
    if (terlemah === null || RANK[bucket] < RANK[terlemah]) terlemah = bucket;
  }
  return terlemah;
}

/** Hitung ulang satu Order dan tulis Order.status kalau berubah + berhak. */
export async function syncOrderStatus(tx, orderId) {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: { status: true, statusLocked: true, category: true },
  });
  if (!order || order.statusLocked) return;
  // SEWA (4 Sep 2026) punya status sendiri (SEWA_DIKIRIM/SEWA_DIAMBIL,
  // diset manual lewat override statusLocked di titik create/edit) — lepas
  // total dari perhitungan Unit/Bengkel, yang memang dibangun untuk alur
  // produksi LAYANAN/BARU. Jangan biarkan Unit sewa (dibuat utk keperluan
  // Armada antar/ambil) diam-diam menimpa status SEWA.
  if (order.category === "SEWA") return;

  const units = await tx.unit.findMany({ where: { orderId }, select: { status: true, currentStageId: true } });
  const computed = computeOrderStatus(units);
  if (computed === null || computed === order.status) return;

  await tx.order.update({ where: { id: orderId }, data: { status: computed } });
  await tx.orderStatusTransition.create({
    data: { orderId, fromStatus: order.status, toStatus: computed, changedById: null },
  });
}

/**
 * Dipakai titik yang mengubah banyak unit lintas order dalam satu batch
 * (mis. updateMany job Armada) — sinkronkan tiap order yang terdampak,
 * bukan cuma satu.
 */
export async function syncOrderStatusForUnits(tx, unitIds) {
  if (!unitIds || unitIds.length === 0) return;
  const units = await tx.unit.findMany({ where: { id: { in: unitIds } }, select: { orderId: true } });
  const orderIds = [...new Set(units.map((u) => u.orderId))];
  for (const orderId of orderIds) await syncOrderStatus(tx, orderId);
}
