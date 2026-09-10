// Production Core Slice 4 — Route/Work Center/Operator staffing.
//
// TERPISAH SENGAJA dari unitStageEngine.js (yang tetap satu-satunya
// penjaga TRANSISI TAHAP — START/PAUSE/RESUME/COMPLETE/FAIL/SKIP). File
// ini menjaga urusan PERENCANAAN: snapshot rute produksi (Slice 4A/4D)
// dan siapa yang DIHARAPKAN mengerjakan sebuah tahap (StageAssignment) —
// dua hal yang TIDAK PERNAH boleh tercampur dengan "siapa yang SUNGGUHAN
// mengerjakan" (itu tetap UnitStageLog.actorId, tidak disentuh di sini).
//
// StageTransitionError DIPAKAI ULANG dari unitStageEngine.js (bukan kelas
// error baru) supaya handleEngineError() di routes/units.js/production.js
// mengenali error dari sini dengan cara yang SAMA PERSIS.

import { prisma } from "../db.js";
import { StageTransitionError } from "./unitStageEngine.js";
import { buildUnitPath } from "../lib/domain/routing.js";
import { buildRouteStageSnapshot, canReplaceRoute, deriveSkillWarning } from "../lib/domain/productionRouting.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";

/** true kalau unit ini SUDAH punya minimal satu baris eksekusi (Slice 4Q guardrail). */
async function hasExecutionHistory(tx, unitId) {
  const count = await tx.unitStageLog.count({ where: { unitId } });
  return count > 0;
}

/**
 * Cari ProductionRoute AKTIF untuk sebuah layanan — kalau belum ada,
 * BUAT dari jalur LIVE (ServiceCatalogModule + RoutingStage, mesin routing
 * yang SAMA dipakai unitStageEngine.js, TIDAK dihitung ulang dengan cara
 * lain). "Avoid creating a new route from scratch every time" (Slice 4D) —
 * dipanggil berkali-kali untuk service yang sama akan SELALU mengembalikan
 * baris yang sudah ada, bukan membuat versi baru tiap kali.
 *
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {string} serviceId
 * @returns {Promise<object|null>} ProductionRoute (dengan stages), atau
 *   null kalau layanan ini belum punya tahap MODULE apa pun (tidak ada
 *   yang bisa dijadikan rute — dibiarkan null, BUKAN error keras, supaya
 *   PATCH /units/:id/service tetap berhasil menetapkan layanan walau
 *   katalognya belum lengkap).
 */
export async function resolveOrCreateActiveRoute(tx, serviceId) {
  const existing = await tx.productionRoute.findFirst({
    where: { serviceId, active: true },
    include: { stages: { orderBy: { sequence: "asc" } } },
  });
  if (existing) return existing;

  const service = await tx.serviceCatalog.findUnique({ where: { id: serviceId } });
  if (!service) return null;

  const [intakeStages, finishStages, moduleMappings] = await Promise.all([
    tx.routingStage.findMany({ where: { phase: "INTAKE", active: true } }),
    tx.routingStage.findMany({ where: { phase: "FINISH", active: true } }),
    tx.serviceCatalogModule.findMany({ where: { serviceId }, orderBy: { sequence: "asc" }, include: { stage: true } }),
  ]);
  const path = buildUnitPath(intakeStages, moduleMappings.map((m) => m.stage), finishStages);
  if (path.length === 0) return null;

  const stageRows = buildRouteStageSnapshot(path);
  const maxVersion = await tx.productionRoute.aggregate({ where: { serviceId }, _max: { version: true } });
  const nextVersion = (maxVersion._max.version || 0) + 1;

  return tx.productionRoute.create({
    data: {
      serviceId, version: nextVersion, code: service.code, name: service.labelId, active: true,
      stages: { create: stageRows },
    },
    include: { stages: { orderBy: { sequence: "asc" } } },
  });
}

/**
 * Provisioning OTOMATIS/best-effort — dipanggil dari PATCH /units/:id/service
 * (Slice 1, TIDAK diubah alurnya) SETELAH serviceId ditulis. TIDAK PERNAH
 * melempar error (kegagalan di sini tidak boleh menggagalkan penetapan
 * layanan yang sudah sah) dan TIDAK PERNAH menimpa snapshot unit yang
 * SUDAH punya riwayat eksekusi (guardrail Slice 4Q — silent no-op, bukan
 * reject keras; reject keras itu tugas changeUnitRoute() di bawah untuk
 * jalur EKSPLISIT).
 *
 * @returns {Promise<object|null>} ProductionRoute yang terpasang, atau null kalau tidak ada perubahan
 */
export async function tryProvisionUnitRoute(tx, unitId, serviceId, actorId) {
  if (await hasExecutionHistory(tx, unitId)) return null;

  const route = await resolveOrCreateActiveRoute(tx, serviceId);
  if (!route) return null;

  const unit = await tx.unit.findUnique({ where: { id: unitId }, select: { productionRouteId: true } });
  if (unit.productionRouteId === route.id) return route;

  await tx.unit.update({ where: { id: unitId }, data: { productionRouteId: route.id } });
  await recordActivity(tx, {
    entityType: ENTITY_TYPES.UNIT, entityId: unitId, eventType: EVENT_TYPES.ROUTE_ASSIGNED, actorId,
    metadata: {
      fromRouteId: unit.productionRouteId, toRouteId: route.id,
      routeName: route.name, routeVersion: route.version,
    },
  });
  return route;
}

/**
 * Ganti/tetapkan rute produksi unit secara EKSPLISIT (Slice 4Q, endpoint
 * POST /units/:id/route) — SATU-SATUNYA jalur yang MENOLAK KERAS
 * (StageTransitionError 409) kalau unit sudah punya riwayat eksekusi dan
 * resolusi rute barunya BEDA dari yang sekarang. Scope Revision adalah
 * konsep TERPISAH (Slice 4R) — endpoint ini TIDAK dipakai untuk itu.
 */
export async function changeUnitRoute(unitId, { actorId } = {}) {
  return prisma.$transaction(async (tx) => {
    const unit = await tx.unit.findUniqueOrThrow({ where: { id: unitId } });
    if (!unit.serviceId) {
      throw new StageTransitionError("Unit belum punya layanan — tetapkan layanan dulu (PATCH /units/:id/service) sebelum rute bisa ditentukan");
    }

    const route = await resolveOrCreateActiveRoute(tx, unit.serviceId);
    if (!route) {
      throw new StageTransitionError("Layanan ini belum punya tahap MODULE yang bisa dijadikan rute — periksa konfigurasi katalog layanan");
    }
    if (unit.productionRouteId === route.id) {
      return { route, changed: false };
    }

    const hasHistory = await hasExecutionHistory(tx, unitId);
    if (hasHistory && !canReplaceRoute({ hasExecutionHistory: true })) {
      throw new StageTransitionError("Rute produksi tidak dapat diganti setelah pengerjaan dimulai", 409);
    }

    await tx.unit.update({ where: { id: unitId }, data: { productionRouteId: route.id } });
    await recordActivity(tx, {
      entityType: ENTITY_TYPES.UNIT, entityId: unitId, eventType: EVENT_TYPES.ROUTE_ASSIGNED, actorId,
      metadata: {
        fromRouteId: unit.productionRouteId, toRouteId: route.id,
        routeName: route.name, routeVersion: route.version,
      },
    });
    return { route, changed: true };
  });
}

/**
 * Tugaskan/ganti Work Center + Operator untuk SATU (unit, stage) — Slice
 * 4H/4I. `workCenterId`/`operatorId` undefined = "tidak diubah" (biarkan
 * nilai sekarang), null = "dikosongkan secara eksplisit" (unassign).
 * SELALU transaksional + diaudit (WORK_CENTER_ASSIGNED/OPERATOR_ASSIGNED/
 * OPERATOR_REASSIGNED/OPERATOR_UNASSIGNED), HANYA untuk field yang
 * BENAR-BENAR berubah — pola sama dengan PATCH /units/:id/production.
 *
 * Ketidakcocokan skill (Slice 4G) TIDAK PERNAH memblokir — dikembalikan
 * sebagai `skillWarning` untuk ditampilkan ke supervisor, assignment tetap
 * tersimpan.
 */
export async function assignStage(unitId, stageId, { workCenterId, operatorId, actorId, note } = {}) {
  return prisma.$transaction(async (tx) => {
    const stage = await tx.routingStage.findUniqueOrThrow({ where: { id: stageId } });
    await tx.unit.findUniqueOrThrow({ where: { id: unitId }, select: { id: true } });

    if (workCenterId) {
      const wc = await tx.workCenter.findUnique({ where: { id: workCenterId } });
      if (!wc) throw new StageTransitionError("Work Center tidak ditemukan");
      if (!wc.active) throw new StageTransitionError(`Work Center "${wc.name}" sudah nonaktif — tidak bisa ditugaskan`);
    }

    let operator = null;
    if (operatorId) {
      operator = await tx.productionOperator.findUnique({ where: { id: operatorId }, include: { skills: true, user: true } });
      if (!operator) throw new StageTransitionError("Operator tidak ditemukan");
      if (!operator.active) throw new StageTransitionError(`Operator "${operator.user.name}" sudah nonaktif — tidak bisa ditugaskan`);
    }

    const before = await tx.stageAssignment.findUnique({
      where: { unitId_stageId: { unitId, stageId } },
      include: { workCenter: true, operator: { include: { user: true } } },
    });

    const nextWorkCenterId = workCenterId !== undefined ? workCenterId : (before?.workCenterId ?? null);
    const nextOperatorId = operatorId !== undefined ? operatorId : (before?.operatorId ?? null);

    const assignment = await tx.stageAssignment.upsert({
      where: { unitId_stageId: { unitId, stageId } },
      create: {
        unitId, stageId, workCenterId: nextWorkCenterId, operatorId: nextOperatorId,
        assignedById: actorId || null, note: note?.trim() || null,
      },
      update: {
        workCenterId: nextWorkCenterId, operatorId: nextOperatorId,
        assignedById: actorId || null, note: note?.trim() || null,
      },
      include: { workCenter: true, operator: { include: { user: true } } },
    });

    const beforeWorkCenterId = before?.workCenterId ?? null;
    if (beforeWorkCenterId !== nextWorkCenterId) {
      await recordActivity(tx, {
        entityType: ENTITY_TYPES.UNIT, entityId: unitId, eventType: EVENT_TYPES.WORK_CENTER_ASSIGNED, actorId,
        metadata: { stage: stage.labelId, from: before?.workCenter?.name || null, to: assignment.workCenter?.name || null },
      });
    }

    const beforeOperatorId = before?.operatorId ?? null;
    if (beforeOperatorId !== nextOperatorId) {
      const eventType = !beforeOperatorId ? EVENT_TYPES.OPERATOR_ASSIGNED
        : !nextOperatorId ? EVENT_TYPES.OPERATOR_UNASSIGNED
        : EVENT_TYPES.OPERATOR_REASSIGNED;
      await recordActivity(tx, {
        entityType: ENTITY_TYPES.UNIT, entityId: unitId, eventType, actorId,
        metadata: { stage: stage.labelId, from: before?.operator?.user?.name || null, to: assignment.operator?.user?.name || null },
      });
    }

    const skillWarning = operator ? deriveSkillWarning(operator.skills, stageId) : null;
    return { assignment, skillWarning };
  });
}

/**
 * StageAssignment untuk tahap SEKARANG masing-masing unit, SATU query
 * batch — pola SAMA dengan loadLastCurrentStageLogs/loadOpenBlockersByUnit
 * di unitStageEngine.js (client=prisma dapat diganti stub utk tes tanpa
 * DB, lihat tests/queryBatching.test.js).
 *
 * @param {{id:string, currentStageId?:string|null}[]} units
 * @param {object} [client]
 * @returns {Promise<Record<string, object>>} unitId -> StageAssignment (dengan workCenter+operator.user)
 */
export async function loadCurrentStageAssignments(units, client = prisma) {
  const withStage = (units || []).filter((u) => u.currentStageId);
  if (withStage.length === 0) return {};

  const rows = await client.stageAssignment.findMany({
    where: { OR: withStage.map((u) => ({ unitId: u.id, stageId: u.currentStageId })) },
    include: { workCenter: true, operator: { include: { user: { select: { id: true, name: true } } } } },
  });
  return Object.fromEntries(rows.map((r) => [r.unitId, r]));
}

export { StageTransitionError };
