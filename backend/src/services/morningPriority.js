// Usulan Prioritas Pagi — jembatan Route Planner <-> Produksi (3 Oktober 2026).
//
// KONTEKS (laporan owner): rute pengiriman butuh draft dari pagi, padahal order yang masih "Diproses"
// belum punya Job DELIVERY sama sekali (Job itu baru lahir otomatis saat unit jadi READY_FOR_DELIVERY —
// lihat deliveryHandoff.js#suggestDeliveryJob, dipanggil dari unitStageEngine.js). Melonggarkan aturan
// itu berarti mengaudit ulang semua titik yang mengasumsikannya (lihat orderStatusSync.js reopen-cascade)
// — risiko besar untuk kebutuhan yang sebenarnya cuma "produksi tahu order mana diprioritaskan pagi ini".
//
// REVISI DESAIN (3 Oktober 2026, langsung di hari yang sama — laporan owner: "gaperlu menunggu
// persetujuan produksi... Nadya dan Natasha diskusi target produksi dan jalur di pagi hari, kalo minta
// persetujuan... terlalu lama"). Versi PERTAMA fitur ini punya gerbang persetujuan (dispatcher usul,
// production approve/reject) — TERNYATA tidak cocok dengan cara kerja sungguhan: dispatcher dan
// production lead sudah saling bicara langsung tiap pagi, gerbang approve cuma menambah klik tanpa
// menambah keputusan nyata. SEKARANG: Dispatcher menandai LANGSUNG berlaku (priority diterapkan saat
// itu juga ke unit aktif order) — TETAP tercatat siapa yang menandai (ActivityEvent, sama pola dengan
// semua perubahan priority lain), dan Production/Dispatcher BERDUA bisa membatalkan (dismiss) kalau
// ternyata keliru. Pemisahan tugas yang SEBELUMNYA ada (dispatcher tidak punya UNIT_ROUTING_WRITE)
// TETAP berlaku untuk jalur UMUM (PATCH /units/:id/production) — di sini dispatcher diberi kemampuan
// SEMPIT, cuma lewat endpoint usulan ini, cuma untuk order yang dia tandai sendiri pagi itu. Bukan
// melebarkan izin produksi dispatcher secara umum.
//
// Priority ditulis ke SEMUA unit AKTIF order itu (bukan DELIVERED/CANCELLED) lewat pola PERSIS SAMA
// dengan PATCH /units/:id/production (recordActivity PRIORITY_CHANGED per unit) — bukan jalur baru,
// cuma dipicu dari tempat berbeda.

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

async function terapkanPriorityKeUnitAktif(tx, { orderId, priority, actorId, requestId }) {
  const units = await tx.unit.findMany({
    where: { orderId, status: { notIn: ACTIVE_UNIT_STATUSES_EXCLUDED } },
    select: { id: true, priority: true },
  });
  for (const u of units) {
    if (u.priority === priority) continue; // tidak menulis "X -> X" (pola sama dengan PATCH /units/:id/production)
    await tx.unit.update({ where: { id: u.id }, data: { priority } });
    await recordActivity(tx, {
      entityType: ENTITY_TYPES.UNIT, entityId: u.id,
      eventType: EVENT_TYPES.PRIORITY_CHANGED, actorId,
      metadata: { from: u.priority, to: priority, source: "morning_priority_request", requestId },
    });
  }
  return units.length;
}

/**
 * Dispatcher menandai prioritas pagi untuk satu order yang masih PROCESSING — BERLAKU LANGSUNG, tanpa
 * menunggu persetujuan terpisah (lihat catatan revisi desain di atas). Idempoten per order: kalau order
 * ini SUDAH ditandai dan masih APPROVED, priority-nya DIPERBARUI (bukan baris baru) — dispatcher/
 * production boleh menaikkan/menurunkan level cukup dengan menandai ulang.
 */
export async function requestMorningPriority({ orderId, requestedById, note, suggestedPriority = "HIGH" }) {
  if (!PRODUCTION_PRIORITY_VALUES.includes(suggestedPriority)) {
    throw new MorningPriorityError(`suggestedPriority harus salah satu dari: ${PRODUCTION_PRIORITY_VALUES.join(", ")}`);
  }
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true, status: true, orderNumber: true } });
  if (!order) throw new MorningPriorityError("Order tidak ditemukan", 404);
  if (order.status !== "PROCESSING") {
    throw new MorningPriorityError("Hanya order berstatus Diproses yang bisa ditandai — order ini sudah di tahap lain");
  }

  const existing = await prisma.morningPriorityRequest.findFirst({ where: { orderId, status: "APPROVED" } });

  return prisma.$transaction(async (tx) => {
    await terapkanPriorityKeUnitAktif(tx, { orderId, priority: suggestedPriority, actorId: requestedById, requestId: existing?.id });

    const row = existing
      ? await tx.morningPriorityRequest.update({
          where: { id: existing.id },
          data: { suggestedPriority, appliedPriority: suggestedPriority, note: note ?? existing.note },
        })
      : await tx.morningPriorityRequest.create({
          data: {
            orderId, requestedById, note: note || null, suggestedPriority,
            status: "APPROVED", decidedById: requestedById, decidedAt: new Date(), appliedPriority: suggestedPriority,
          },
        });

    await recordActivity(tx, {
      entityType: ENTITY_TYPES.ORDER, entityId: orderId,
      eventType: EVENT_TYPES.MORNING_PRIORITY_REQUESTED, actorId: requestedById,
      metadata: { requestId: row.id, suggestedPriority, note: note || null, orderNumber: order.orderNumber },
    });
    return row;
  });
}

/**
 * Batalkan — tersedia untuk DISPATCHER (JOB_WRITE) maupun Production (UNIT_ROUTING_WRITE), sama-sama
 * boleh membatalkan kalau ternyata keliru (lihat catatan revisi desain: koordinasi dua arah, bukan lagi
 * gerbang satu arah). Priority unit yang masih SAMA dengan appliedPriority dikembalikan ke NORMAL;
 * unit yang sudah berubah lagi lewat jalur lain (mis. PATCH /units/:id/production manual) TIDAK ditimpa.
 */
export async function dismissMorningPriority({ id, decidedById }) {
  return prisma.$transaction(async (tx) => {
    const req = await tx.morningPriorityRequest.findUnique({ where: { id } });
    if (!req) throw new MorningPriorityError("Usulan tidak ditemukan", 404);
    if (req.status === "DISMISSED") throw new MorningPriorityError("Usulan ini sudah dibatalkan sebelumnya", 409);

    if (req.status === "APPROVED" && req.appliedPriority) {
      const units = await tx.unit.findMany({
        where: { orderId: req.orderId, status: { notIn: ACTIVE_UNIT_STATUSES_EXCLUDED }, priority: req.appliedPriority },
        select: { id: true, priority: true },
      });
      for (const u of units) {
        await tx.unit.update({ where: { id: u.id }, data: { priority: "NORMAL" } });
        await recordActivity(tx, {
          entityType: ENTITY_TYPES.UNIT, entityId: u.id,
          eventType: EVENT_TYPES.PRIORITY_CHANGED, actorId: decidedById,
          metadata: { from: u.priority, to: "NORMAL", source: "morning_priority_request_dismiss", requestId: id },
        });
      }
    }

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

/** `status` opsional (default APPROVED — yang masih berlaku sekarang, dibutuhkan papan Produksi & Route Planner). */
export async function listMorningPriorityRequests({ status = "APPROVED" } = {}) {
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
