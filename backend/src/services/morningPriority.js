// Usulan Prioritas Pagi — jembatan Route Planner <-> Produksi (3 Oktober 2026).
//
// KONTEKS (laporan owner): rute pengiriman butuh draft dari pagi, padahal order yang masih "Diproses"
// belum punya Job DELIVERY sama sekali (Job itu baru lahir otomatis saat unit jadi READY_FOR_DELIVERY —
// lihat deliveryHandoff.js#suggestDeliveryJob, dipanggil dari unitStageEngine.js). Melonggarkan aturan
// itu berarti mengaudit ulang semua titik yang mengasumsikannya (lihat orderStatusSync.js reopen-cascade)
// — risiko besar untuk kebutuhan yang sebenarnya cuma "produksi tahu order mana diprioritaskan pagi ini".
//
// DESAIN YANG DIPILIH: Dispatcher (permission JOB_WRITE, Route Planner) mengUSULKAN dari order yang
// Order.status masih PROCESSING — TIDAK membuat Job/unit apa pun, murni baris usulan. Production Lead/
// Admin/Owner (permission UNIT_ROUTING_WRITE, pemegang sah ProductionPriority) MENYETUJUI atau MENOLAK.
// Dispatcher SENGAJA TIDAK diberi UNIT_ROUTING_WRITE — pola pemisahan tugas yang konsisten di seluruh
// sistem ini (bandingkan SALES: UNIT_READ tanpa UNIT_ROUTING_WRITE, "melihat produksi, bukan menulisnya").
//
// Saat disetujui: priority ditulis ke SEMUA unit AKTIF order itu (bukan DELIVERED/CANCELLED) lewat pola
// PERSIS SAMA dengan PATCH /units/:id/production (recordActivity PRIORITY_CHANGED per unit) — bukan
// jalur baru, cuma dipicu dari tempat berbeda.

import { prisma } from "../db.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";
import { PRODUCTION_PRIORITY_VALUES } from "../lib/domain/productionState.js";

export class MorningPriorityError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "MorningPriorityError";
    this.status = status;
  }
}

const ACTIVE_UNIT_STATUSES_EXCLUDED = ["DELIVERED", "CANCELLED"];

/**
 * Dispatcher mengusulkan prioritas pagi untuk satu order yang masih PROCESSING.
 * Idempoten per order: kalau order ini SUDAH punya usulan PENDING, baris yang sama dikembalikan
 * (bukan duplikat) — dispatcher boleh klik berkali-kali tanpa menumpuk baris, konsisten dengan pola
 * idempotensi lain di codebase ini.
 */
export async function requestMorningPriority({ orderId, requestedById, note, suggestedPriority = "HIGH" }) {
  if (!PRODUCTION_PRIORITY_VALUES.includes(suggestedPriority)) {
    throw new MorningPriorityError(`suggestedPriority harus salah satu dari: ${PRODUCTION_PRIORITY_VALUES.join(", ")}`);
  }
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true, status: true, orderNumber: true } });
  if (!order) throw new MorningPriorityError("Order tidak ditemukan", 404);
  if (order.status !== "PROCESSING") {
    throw new MorningPriorityError("Hanya order berstatus Diproses yang bisa diusulkan — order ini sudah di tahap lain");
  }

  const existing = await prisma.morningPriorityRequest.findFirst({
    where: { orderId, status: "PENDING" },
  });
  if (existing) return existing;

  return prisma.$transaction(async (tx) => {
    const created = await tx.morningPriorityRequest.create({
      data: { orderId, requestedById, note: note || null, suggestedPriority },
    });
    await recordActivity(tx, {
      entityType: ENTITY_TYPES.ORDER, entityId: orderId,
      eventType: EVENT_TYPES.MORNING_PRIORITY_REQUESTED, actorId: requestedById,
      metadata: { requestId: created.id, suggestedPriority, note: note || null, orderNumber: order.orderNumber },
    });
    return created;
  });
}

/**
 * Production menyetujui: priority DITERAPKAN ke semua unit aktif order ini (bukan DELIVERED/CANCELLED).
 * `priority` opsional — kalau tidak dikirim, pakai suggestedPriority dispatcher apa adanya.
 */
export async function approveMorningPriority({ id, decidedById, priority }) {
  const finalPriority = priority || undefined;
  if (finalPriority && !PRODUCTION_PRIORITY_VALUES.includes(finalPriority)) {
    throw new MorningPriorityError(`priority harus salah satu dari: ${PRODUCTION_PRIORITY_VALUES.join(", ")}`);
  }
  return prisma.$transaction(async (tx) => {
    const req = await tx.morningPriorityRequest.findUnique({ where: { id } });
    if (!req) throw new MorningPriorityError("Usulan tidak ditemukan", 404);
    if (req.status !== "PENDING") throw new MorningPriorityError("Usulan ini sudah diputuskan sebelumnya", 409);

    const appliedPriority = finalPriority || req.suggestedPriority;
    const units = await tx.unit.findMany({
      where: { orderId: req.orderId, status: { notIn: ACTIVE_UNIT_STATUSES_EXCLUDED } },
      select: { id: true, priority: true },
    });
    for (const u of units) {
      if (u.priority === appliedPriority) continue; // tidak menulis "X -> X" (pola sama dengan PATCH /units/:id/production)
      await tx.unit.update({ where: { id: u.id }, data: { priority: appliedPriority } });
      await recordActivity(tx, {
        entityType: ENTITY_TYPES.UNIT, entityId: u.id,
        eventType: EVENT_TYPES.PRIORITY_CHANGED, actorId: decidedById,
        metadata: { from: u.priority, to: appliedPriority, source: "morning_priority_request", requestId: id },
      });
    }

    const updated = await tx.morningPriorityRequest.update({
      where: { id },
      data: { status: "APPROVED", decidedById, decidedAt: new Date(), appliedPriority },
    });
    await recordActivity(tx, {
      entityType: ENTITY_TYPES.ORDER, entityId: req.orderId,
      eventType: EVENT_TYPES.MORNING_PRIORITY_APPROVED, actorId: decidedById,
      metadata: { requestId: id, appliedPriority, unitCount: units.length },
    });
    return updated;
  });
}

export async function dismissMorningPriority({ id, decidedById }) {
  return prisma.$transaction(async (tx) => {
    const req = await tx.morningPriorityRequest.findUnique({ where: { id } });
    if (!req) throw new MorningPriorityError("Usulan tidak ditemukan", 404);
    if (req.status !== "PENDING") throw new MorningPriorityError("Usulan ini sudah diputuskan sebelumnya", 409);

    const updated = await tx.morningPriorityRequest.update({
      where: { id },
      data: { status: "DISMISSED", decidedById, decidedAt: new Date() },
    });
    await recordActivity(tx, {
      entityType: ENTITY_TYPES.ORDER, entityId: req.orderId,
      eventType: EVENT_TYPES.MORNING_PRIORITY_DISMISSED, actorId: decidedById,
      metadata: { requestId: id },
    });
    return updated;
  });
}

/** `status` opsional (default PENDING, yang dibutuhkan papan Produksi & Route Planner). */
export async function listMorningPriorityRequests({ status = "PENDING" } = {}) {
  return prisma.morningPriorityRequest.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "asc" },
    include: {
      order: { select: { id: true, orderNumber: true, deliveryAddress: true, deliveryCity: true, customer: { select: { name: true } } } },
      requestedBy: { select: { id: true, name: true } },
      decidedBy: { select: { id: true, name: true } },
    },
  });
}
