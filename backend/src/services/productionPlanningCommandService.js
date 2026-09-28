// Command owner Planning Produksi H-1 (Production Workshop + Warehouse V2, slice P3).
// SATU-SATUNYA penulis production_run_plans_v2 / planned_bom_lines_v2 / material_reservations_v2
// (lihat scripts/production-delivery-v2/audit-planning-writers.js).
//
// Kontrak:
//  - Writer & reader di balik flag production_v2_writer/production_v2_reader — SAMA flag dengan P1-P2
//    custody (cohort config.unitIds per Unit, fail-closed: unit di luar cohort/tanpa unitId = tanpa V2).
//  - Setiap command: v2_commands (idempotency per actorId+Idempotency-Key) + perubahan state + domain_outbox
//    dalam satu transaksi Prisma — commit/batal bersama.
//  - Reservasi mengunci baris `materials` (lockMaterialBalance/lockRowForUpdate, dipakai ULANG dari
//    inventoryLedger.js, TIDAK diduplikasi) dalam URUTAN DETERMINISTIK (materialId diurutkan ascending)
//    sebelum menghitung availability — mencegah deadlock antara dua command reservasi yang berebut material
//    yang sama dalam urutan berbeda.
//  - Available = on-hand (SUM stock_movements, lockMaterialBalance) MINUS reserved V1 (MaterialIssueLine,
//    RESERVED_STATUSES — punya Warehouse Material Issue yang sudah live) MINUS reserved V2 aktif
//    (material_reservations_v2 status ACTIVE, material yang sama, plan MANA PUN) — dua jalur reservasi tidak
//    boleh buta satu sama lain atau stok yang sama bisa dijanjikan dua kali.
//  - Kalau available kurang untuk material APA PUN dalam Planned BOM, SELURUH command gagal (rollback total
//    lewat exception di dalam prisma.$transaction) — tidak ada reservasi sebagian yang tersisa.
//  - Slice ini BERHENTI di reservasi: TIDAK PERNAH menulis stock_movements (stok fisik belum berkurang).
//    Pengurangan fisik ada di Material Issue/PICKED, slice berikutnya (P4).
//  - Command ini TIDAK PERNAH menyentuh ProductionRun.status/currentPhase atau ProductionPhaseRun — planning
//    murni metadata pra-kerja; fase PROCESS baru dimulai lewat jalur produksi lain (di luar scope P3).
import { createHash } from "node:crypto";
import { recordActivity, EVENT_TYPES } from "../lib/activityLog.js";
import { lockMaterialBalance, lockRowForUpdate, RESERVED_STATUSES } from "./inventoryLedger.js";
import { isProductionWriterEnabledFor, loadV2Flags, resolveProductionWriterState } from "./v2FeatureFlags.js";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{12,128}$/;
const EPSILON = 1e-6;
const ACTIVE_PLAN_STATUSES = ["DRAFT", "PLANNED", "MATERIAL_RESERVED"];

function planError(message, statusCode, code, details) {
  return Object.assign(new Error(message), { statusCode, code, ...(details ? { details } : {}) });
}

const hash = (value) => createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");

export function assertIdempotencyKey(key) {
  if (!key || !IDEMPOTENCY_KEY.test(key)) {
    throw planError("Idempotency-Key wajib diisi (12-128 karakter)", 400, "IDEMPOTENCY_KEY_INVALID");
  }
}

export function assertExpectedRevision(value) {
  const revision = Number(value);
  if (value == null || value === "" || !Number.isInteger(revision) || revision < 1) {
    throw planError("expectedRevision wajib diisi (angka bulat positif)", 400, "EXPECTED_REVISION_REQUIRED");
  }
  return revision;
}

// Aturan transisi murni (diuji unit).
export function assertPlanRevision(plan, expectedRevision) {
  if (plan.revision !== expectedRevision) {
    throw planError(`Revisi rencana berubah: diharapkan ${expectedRevision}, sekarang ${plan.revision}. Muat ulang.`, 409, "PLAN_REVISION_CONFLICT", { revision: plan.revision });
  }
}

export function assertPlanNotCancelled(plan) {
  if (plan.status === "CANCELLED") {
    throw planError("Rencana produksi ini sudah dibatalkan", 409, "PLAN_CANCELLED", { status: plan.status });
  }
}

export function assertPlanBOMLines(lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw planError("Planned BOM wajib memuat minimal satu bahan", 400, "PLAN_BOM_EMPTY");
  }
  const seen = new Set();
  for (const line of lines) {
    if (!line?.materialId) throw planError("materialId wajib diisi untuk setiap baris BOM", 400, "PLAN_BOM_MATERIAL_REQUIRED");
    if (seen.has(line.materialId)) throw planError("Satu material tidak boleh muncul dua kali dalam Planned BOM", 400, "PLAN_BOM_DUPLICATE_MATERIAL", { materialId: line.materialId });
    seen.add(line.materialId);
    const qty = Number(line.qty);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw planError("Jumlah bahan pada Planned BOM wajib diisi dan lebih dari nol", 400, "PLAN_BOM_QTY_INVALID", { materialId: line.materialId });
    }
  }
}

async function beginCommand(tx, { actor, idempotencyKey, commandType, aggregateType, aggregateId, requestHash, expectedRevision = null }) {
  return tx.v2Command.create({
    data: { domain: "PRODUCTION", actorId: actor, idempotencyKey, commandType, aggregateType, aggregateId, expectedRevision, requestHash },
  });
}

async function finishCommand(tx, command, appliedRevision, response) {
  await tx.v2Command.update({ where: { id: command.id }, data: { status: "APPLIED", appliedRevision, response, completedAt: new Date() } });
}

async function outbox(tx, { eventType, aggregateType, aggregateId, revision, dedupeKey, payload }) {
  return tx.domainOutbox.create({
    data: { domain: "PRODUCTION", eventType, aggregateType, aggregateId, aggregateRevision: revision, dedupeKey, payload },
  });
}

async function findReplay(tx, actor, idempotencyKey, requestHash) {
  const replay = await tx.v2Command.findUnique({ where: { actorId_idempotencyKey: { actorId: actor, idempotencyKey } } });
  if (!replay) return null;
  if (replay.requestHash !== requestHash) throw planError("Idempotency-Key dipakai untuk payload berbeda", 409, "IDEMPOTENCY_CONFLICT");
  if (replay.status !== "APPLIED") throw planError("Command masih diproses", 409, "COMMAND_IN_PROGRESS");
  return { replayed: true, ...replay.response };
}

async function assertWriterEnabledForUnit(tx, unitId) {
  const state = resolveProductionWriterState(await loadV2Flags(tx));
  if (!isProductionWriterEnabledFor(state, unitId)) {
    throw planError("Planning V2 tidak aktif untuk unit ini; gunakan alur lama", 503, "PLANNING_WRITER_OFF");
  }
}

// ---------------------------------------------------------------------------
// 1. Buat rencana (DRAFT) untuk satu Production Run yang eligible.
// ---------------------------------------------------------------------------
export async function createProductionPlan(prisma, { runId, actorId, idempotencyKey }) {
  if (!runId) throw planError("runId wajib diisi", 400, "PLAN_RUN_ID_REQUIRED");
  assertIdempotencyKey(idempotencyKey);
  const actor = actorId || "SYSTEM";
  const requestHash = hash({ commandType: "CREATE_PLAN", runId });

  return prisma.$transaction(async (tx) => {
    await lockRowForUpdate(tx, "production_runs_v2", runId);
    const replay = await findReplay(tx, actor, idempotencyKey, requestHash);
    if (replay) return replay;

    const run = await tx.productionRun.findUnique({
      where: { id: runId },
      include: {
        unit: { select: { id: true, unitCode: true, orderId: true } },
        plan: true,
        phases: { where: { phase: "PROCESS" }, select: { status: true } },
        custodyHandoffs: { where: { direction: "INBOUND", status: "ACCEPTED" }, select: { id: true }, take: 1 },
      },
    });
    if (!run) throw planError("Production Run tidak ditemukan", 404, "PLAN_RUN_NOT_FOUND");
    await assertWriterEnabledForUnit(tx, run.unitId);
    if (["COMPLETED", "CANCELLED"].includes(run.status)) {
      throw planError("Production Run ini sudah selesai/dibatalkan; tidak bisa direncanakan", 409, "PLAN_RUN_TERMINAL");
    }
    if (run.phases[0]?.status && ["ACTIVE", "COMPLETED"].includes(run.phases[0].status)) {
      throw planError("Fase Proses sudah dimulai untuk unit ini; rencana H-1 tidak berlaku lagi", 409, "PLAN_TOO_LATE");
    }
    const eligible = run.custodyHandoffs.length > 0 || !!run.migrationSource;
    if (!eligible) {
      throw planError("Unit ini belum memiliki custody/lokasi yang sah (bukan pengecualian data legacy)", 422, "PLAN_UNIT_NOT_ELIGIBLE");
    }
    if (run.plan && run.plan.status !== "CANCELLED") {
      throw planError("Rencana produksi untuk unit ini sudah ada", 409, "PLAN_ALREADY_EXISTS", { planId: run.plan.id, status: run.plan.status });
    }

    const command = await beginCommand(tx, { actor, idempotencyKey, commandType: "CREATE_PLAN", aggregateType: "ProductionRunPlan", aggregateId: runId, requestHash });
    const plan = await tx.productionRunPlan.create({ data: { runId, status: "DRAFT", revision: 1, commandId: command.id } });
    await outbox(tx, {
      eventType: "production.plan.created", aggregateType: "ProductionRunPlan", aggregateId: plan.id, revision: 1,
      dedupeKey: `production-plan-created:${plan.id}`,
      payload: { planId: plan.id, runId, unitId: run.unitId, revision: 1, occurredAt: new Date().toISOString(), actorId },
    });
    await recordActivity(tx, {
      entityType: "unit", entityId: run.unitId, eventType: EVENT_TYPES.PRODUCTION_PLAN_CREATED, actorId: actorId || null,
      metadata: { unitCode: run.unit.unitCode, planId: plan.id, runId },
    });
    const response = { planId: plan.id, runId, status: "DRAFT", revision: 1 };
    await finishCommand(tx, command, 1, response);
    return { replayed: false, ...response };
  });
}

// P4: rencana yang sudah punya permintaan pengambilan bahan AKTIF (READY_TO_PICK) atau sudah DISERAHKAN (ISSUED) tidak
// boleh diubah lewat jalur P3 (lepas reservasi/ubah BOM/batal rencana/reservasi ulang) — kalau tidak, dokumen issue
// menjadi yatim atau bahan yang sudah keluar dipesan lagi. Batalkan permintaan lewat command P4 lebih dulu; setelah
// ISSUED koreksi lewat return/adjustment stok. Baca-saja (tidak menulis tabel P4).
async function assertNoBlockingMaterialIssue(tx, planId) {
  const issue = await tx.materialIssue.findFirst({ where: { productionPlanId: planId, status: { in: ["READY_TO_PICK", "ISSUED"] } }, select: { id: true, status: true } });
  if (!issue) return;
  if (issue.status === "ISSUED") throw planError("Bahan untuk rencana ini sudah diserahkan Gudang; koreksi lewat return/adjustment stok", 409, "PLAN_MATERIAL_ALREADY_ISSUED", { issueId: issue.id });
  throw planError("Ada permintaan pengambilan bahan aktif; batalkan permintaan itu lebih dulu", 409, "PLAN_MATERIAL_ISSUE_ACTIVE", { issueId: issue.id });
}

// Diekspor: dipakai ulang oleh productionMaterialIssueCommandService.js (P4) untuk mengunci+memuat plan di
// dalam TRANSAKSI YANG SAMA dengan command-nya sendiri (mis. batal sebelum pick -> releaseReservationsInTx).
export async function loadPlanForWrite(tx, planId) {
  await lockRowForUpdate(tx, "production_run_plans_v2", planId);
  const plan = await tx.productionRunPlan.findUnique({
    where: { id: planId },
    include: {
      run: { select: { id: true, unitId: true, unit: { select: { unitCode: true } } } },
      bomLines: { where: { status: "ACTIVE" } },
      reservations: { where: { status: "ACTIVE" } },
    },
  });
  if (!plan) throw planError("Rencana produksi tidak ditemukan", 404, "PLAN_NOT_FOUND");
  return plan;
}

// ---------------------------------------------------------------------------
// 2. Penetapan workshop/operator/target waktu (DRAFT -> PLANNED, atau perbarui assignment plan yang sudah ada).
// ---------------------------------------------------------------------------
export async function assignProductionPlan(prisma, { planId, actorId, idempotencyKey, expectedRevision, workCenterId, operatorId, targetStartAt, targetCompleteAt }) {
  assertIdempotencyKey(idempotencyKey);
  const revisionExpected = assertExpectedRevision(expectedRevision);
  if (!workCenterId) throw planError("Workshop/work center wajib dipilih", 400, "PLAN_WORK_CENTER_REQUIRED");
  if (!operatorId) throw planError("Operator wajib dipilih", 400, "PLAN_OPERATOR_REQUIRED");
  const startAt = targetStartAt ? new Date(targetStartAt) : null;
  const completeAt = targetCompleteAt ? new Date(targetCompleteAt) : null;
  if (!startAt || Number.isNaN(startAt.getTime())) throw planError("Target waktu mulai wajib diisi", 400, "PLAN_TARGET_START_REQUIRED");
  if (!completeAt || Number.isNaN(completeAt.getTime())) throw planError("Target waktu selesai wajib diisi", 400, "PLAN_TARGET_COMPLETE_REQUIRED");
  if (completeAt.getTime() <= startAt.getTime()) throw planError("Target selesai harus setelah target mulai", 400, "PLAN_TARGET_RANGE_INVALID");
  const actor = actorId || "SYSTEM";
  const requestHash = hash({ commandType: "ASSIGN_PLAN", planId, expectedRevision: revisionExpected, workCenterId, operatorId, targetStartAt: startAt.toISOString(), targetCompleteAt: completeAt.toISOString() });

  return prisma.$transaction(async (tx) => {
    const replay = await findReplay(tx, actor, idempotencyKey, requestHash);
    if (replay) return replay;
    const plan = await loadPlanForWrite(tx, planId);
    assertPlanNotCancelled(plan);
    assertPlanRevision(plan, revisionExpected);
    await assertWriterEnabledForUnit(tx, plan.run.unitId);

    const workCenter = await tx.workCenter.findUnique({ where: { id: workCenterId } });
    if (!workCenter || !workCenter.active) throw planError("Workshop/work center tidak valid atau nonaktif", 422, "PLAN_WORK_CENTER_INVALID");
    const operator = await tx.productionOperator.findUnique({ where: { id: operatorId } });
    if (!operator || !operator.active) throw planError("Operator tidak valid atau nonaktif", 422, "PLAN_OPERATOR_INVALID");

    const now = new Date();
    const revision = plan.revision + 1;
    const nextStatus = plan.status === "DRAFT" ? "PLANNED" : plan.status;
    const command = await beginCommand(tx, { actor, idempotencyKey, commandType: "ASSIGN_PLAN", aggregateType: "ProductionRunPlan", aggregateId: planId, requestHash, expectedRevision: revisionExpected });
    await tx.productionRunPlan.update({
      where: { id: planId },
      data: {
        workCenterId, operatorId, targetStartAt: startAt, targetCompleteAt: completeAt, revision, status: nextStatus,
        plannedById: plan.plannedAt ? plan.plannedById : (actorId || null), plannedAt: plan.plannedAt || now,
        commandId: command.id,
      },
    });
    await outbox(tx, {
      eventType: "production.plan.assigned", aggregateType: "ProductionRunPlan", aggregateId: planId, revision,
      dedupeKey: `production-plan-assigned:${planId}:${revision}`,
      payload: { planId, runId: plan.runId, unitId: plan.run.unitId, workCenterId, operatorId, targetStartAt: startAt.toISOString(), targetCompleteAt: completeAt.toISOString(), revision, occurredAt: now.toISOString(), actorId },
    });
    await recordActivity(tx, {
      entityType: "unit", entityId: plan.run.unitId, eventType: EVENT_TYPES.PRODUCTION_PLAN_ASSIGNED, actorId: actorId || null,
      metadata: { unitCode: plan.run.unit.unitCode, planId, workCenterCode: workCenter.code, operatorId },
    });
    const response = { planId, status: nextStatus, revision, workCenterId, operatorId, targetStartAt: startAt.toISOString(), targetCompleteAt: completeAt.toISOString() };
    await finishCommand(tx, command, revision, response);
    return { replayed: false, ...response };
  });
}

// ---------------------------------------------------------------------------
// 3. Susun/ubah Planned BOM (full-replace). Mengubah BOM saat sudah MATERIAL_RESERVED melepas SEMUA reservasi
//    aktif milik plan ini dalam transaksi yang SAMA (tidak pernah meninggalkan saldo reservasi yatim) dan
//    mengembalikan status ke PLANNED — reservasi ulang harus dipanggil eksplisit lagi.
// ---------------------------------------------------------------------------
export async function setPlannedBOM(prisma, { planId, actorId, idempotencyKey, expectedRevision, lines }) {
  assertIdempotencyKey(idempotencyKey);
  const revisionExpected = assertExpectedRevision(expectedRevision);
  assertPlanBOMLines(lines);
  const actor = actorId || "SYSTEM";
  const normalized = lines.map((l) => ({ materialId: l.materialId, qty: Number(l.qty) }));
  const requestHash = hash({ commandType: "SET_PLANNED_BOM", planId, expectedRevision: revisionExpected, lines: [...normalized].sort((a, b) => a.materialId.localeCompare(b.materialId)) });

  return prisma.$transaction(async (tx) => {
    const replay = await findReplay(tx, actor, idempotencyKey, requestHash);
    if (replay) return replay;
    const plan = await loadPlanForWrite(tx, planId);
    assertPlanNotCancelled(plan);
    assertPlanRevision(plan, revisionExpected);
    await assertWriterEnabledForUnit(tx, plan.run.unitId);
    await assertNoBlockingMaterialIssue(tx, planId);

    const materials = await tx.material.findMany({ where: { id: { in: normalized.map((l) => l.materialId) } } });
    const byId = new Map(materials.map((m) => [m.id, m]));
    for (const line of normalized) {
      const material = byId.get(line.materialId);
      if (!material) throw planError("Material tidak ditemukan", 404, "PLAN_BOM_MATERIAL_NOT_FOUND", { materialId: line.materialId });
      if (!material.active) throw planError(`Material ${material.code} sudah nonaktif`, 422, "PLAN_BOM_MATERIAL_INACTIVE", { materialId: line.materialId });
    }

    const now = new Date();
    let revision = plan.revision;
    const currentByMaterial = new Map(plan.bomLines.map((l) => [l.materialId, l]));
    const newIds = new Set(normalized.map((l) => l.materialId));

    // Baris lama yang tidak lagi ada di daftar baru, atau qty-nya berubah -> supersede (histori dipertahankan).
    for (const [materialId, oldLine] of currentByMaterial) {
      const next = normalized.find((l) => l.materialId === materialId);
      const changed = !next || Math.abs(Number(oldLine.qty) - next.qty) > EPSILON;
      if (changed) {
        await tx.plannedBOMLine.update({
          where: { id: oldLine.id },
          data: { status: "SUPERSEDED", supersededById: actorId || null, supersededAt: now, revision: oldLine.revision + 1 },
        });
      }
    }
    // Baris baru (materialId belum ACTIVE, atau qty berubah) -> baris baru.
    const createdLines = [];
    for (const line of normalized) {
      const old = currentByMaterial.get(line.materialId);
      const unchanged = old && Math.abs(Number(old.qty) - line.qty) <= EPSILON;
      if (unchanged) continue;
      const material = byId.get(line.materialId);
      const created = await tx.plannedBOMLine.create({
        data: { planId, materialId: line.materialId, qty: line.qty, unit: material.unit, status: "ACTIVE", revision: 1, createdById: actorId || null },
      });
      createdLines.push(created);
    }

    const bomChanged = createdLines.length > 0 || [...currentByMaterial.keys()].some((id) => !newIds.has(id));
    let nextStatus = plan.status;
    let releasedCount = 0;
    if (bomChanged && plan.status === "MATERIAL_RESERVED") {
      for (const reservation of plan.reservations) {
        const nextRevision = reservation.revision + 1;
        await tx.materialReservation.update({
          where: { id: reservation.id },
          data: { status: "RELEASED", releasedById: actorId || null, releasedAt: now, releaseReason: "Planned BOM diubah", revision: nextRevision },
        });
        await outbox(tx, {
          eventType: "production.reservation.released", aggregateType: "MaterialReservation", aggregateId: reservation.id, revision: nextRevision,
          dedupeKey: `production-reservation-released:${reservation.id}:${nextRevision}`,
          payload: { reservationId: reservation.id, planId, materialId: reservation.materialId, reason: "Planned BOM diubah", occurredAt: now.toISOString(), actorId },
        });
        releasedCount += 1;
      }
      nextStatus = "PLANNED";
    }

    revision = plan.revision + 1;
    const command = await beginCommand(tx, { actor, idempotencyKey, commandType: "SET_PLANNED_BOM", aggregateType: "ProductionRunPlan", aggregateId: planId, requestHash, expectedRevision: revisionExpected });
    await tx.productionRunPlan.update({ where: { id: planId }, data: { revision, status: nextStatus, commandId: command.id } });
    await outbox(tx, {
      eventType: "production.plan.bom_set", aggregateType: "ProductionRunPlan", aggregateId: planId, revision,
      dedupeKey: `production-plan-bom-set:${planId}:${revision}`,
      payload: { planId, runId: plan.runId, unitId: plan.run.unitId, lines: normalized, releasedReservations: releasedCount, revision, occurredAt: now.toISOString(), actorId },
    });
    await recordActivity(tx, {
      entityType: "unit", entityId: plan.run.unitId, eventType: EVENT_TYPES.PRODUCTION_PLAN_BOM_SET, actorId: actorId || null,
      metadata: { unitCode: plan.run.unit.unitCode, planId, lineCount: normalized.length, releasedReservations: releasedCount },
    });
    const response = { planId, status: nextStatus, revision, lineCount: normalized.length, releasedReservations: releasedCount };
    await finishCommand(tx, command, revision, response);
    return { replayed: false, ...response };
  });
}

// ---------------------------------------------------------------------------
// 4. Reservasi bahan Gudang untuk Planned BOM (PLANNED -> MATERIAL_RESERVED). Fail-closed atomik.
// ---------------------------------------------------------------------------
async function availableForMaterial(tx, materialId, { excludePlanId = null } = {}) {
  const onHand = await lockMaterialBalance(tx, materialId);
  const [{ reserved: v1Reserved }] = await tx.$queryRaw`
    SELECT COALESCE(SUM(mil.requested_qty), 0)::float AS reserved
    FROM material_issue_lines mil JOIN material_issues mi ON mi.id = mil.material_issue_id
    WHERE mil.material_id = ${materialId}::uuid AND mi.status = ANY(${RESERVED_STATUSES}::"IssueStatus"[]) AND mi.production_plan_id IS NULL
  `;
  const [{ reserved: v2Reserved }] = excludePlanId
    ? await tx.$queryRaw`
        SELECT COALESCE(SUM(qty), 0)::float AS reserved FROM material_reservations_v2
        WHERE material_id = ${materialId}::uuid AND status = 'ACTIVE' AND plan_id <> ${excludePlanId}::uuid
      `
    : await tx.$queryRaw`
        SELECT COALESCE(SUM(qty), 0)::float AS reserved FROM material_reservations_v2
        WHERE material_id = ${materialId}::uuid AND status = 'ACTIVE'
      `;
  return onHand - v1Reserved - v2Reserved;
}

export async function reserveMaterialForPlan(prisma, { planId, actorId, idempotencyKey, expectedRevision }) {
  assertIdempotencyKey(idempotencyKey);
  const revisionExpected = assertExpectedRevision(expectedRevision);
  const actor = actorId || "SYSTEM";
  const requestHash = hash({ commandType: "RESERVE_MATERIAL", planId, expectedRevision: revisionExpected });

  return prisma.$transaction(async (tx) => {
    const replay = await findReplay(tx, actor, idempotencyKey, requestHash);
    if (replay) return replay;
    const plan = await loadPlanForWrite(tx, planId);
    assertPlanNotCancelled(plan);
    assertPlanRevision(plan, revisionExpected);
    await assertWriterEnabledForUnit(tx, plan.run.unitId);
    await assertNoBlockingMaterialIssue(tx, planId);
    if (plan.status === "DRAFT") throw planError("Rencana belum ditetapkan (workshop/operator/target waktu)", 409, "PLAN_NOT_ASSIGNED");
    if (plan.status === "MATERIAL_RESERVED") throw planError("Bahan untuk rencana ini sudah direservasi", 409, "PLAN_ALREADY_RESERVED");
    if (plan.bomLines.length === 0) throw planError("Planned BOM belum diisi", 422, "PLAN_BOM_EMPTY");

    // Urutan lock DETERMINISTIK (materialId ascending) — mencegah deadlock antar command reservasi bersamaan.
    const sortedLines = [...plan.bomLines].sort((a, b) => a.materialId.localeCompare(b.materialId));
    const materials = await tx.material.findMany({ where: { id: { in: sortedLines.map((l) => l.materialId) } } });
    const materialById = new Map(materials.map((m) => [m.id, m]));

    const shortages = [];
    for (const line of sortedLines) {
      const available = await availableForMaterial(tx, line.materialId, { excludePlanId: planId });
      const needed = Number(line.qty);
      if (needed > available + EPSILON) {
        const material = materialById.get(line.materialId);
        shortages.push({ materialId: line.materialId, code: material?.code || line.materialId, needed, available: Math.max(available, 0) });
      }
    }
    if (shortages.length > 0) {
      const detail = shortages.map((s) => `${s.code} (butuh ${s.needed}, tersedia ${s.available})`).join("; ");
      throw planError(`Stok tidak cukup untuk: ${detail}`, 409, "PLAN_MATERIAL_SHORTAGE", { shortages });
    }

    const now = new Date();
    const revision = plan.revision + 1;
    const command = await beginCommand(tx, { actor, idempotencyKey, commandType: "RESERVE_MATERIAL", aggregateType: "ProductionRunPlan", aggregateId: planId, requestHash, expectedRevision: revisionExpected });
    const reservations = [];
    for (const line of sortedLines) {
      const reservation = await tx.materialReservation.create({
        data: { bomLineId: line.id, planId, materialId: line.materialId, qty: line.qty, status: "ACTIVE", reservedById: actorId || null, reservedAt: now, commandId: command.id },
      });
      await outbox(tx, {
        eventType: "production.reservation.created", aggregateType: "MaterialReservation", aggregateId: reservation.id, revision: 1,
        dedupeKey: `production-reservation-created:${reservation.id}`,
        payload: { reservationId: reservation.id, planId, runId: plan.runId, unitId: plan.run.unitId, materialId: line.materialId, qty: Number(line.qty), occurredAt: now.toISOString(), actorId },
      });
      reservations.push({ reservationId: reservation.id, materialId: line.materialId, qty: Number(line.qty) });
    }
    await tx.productionRunPlan.update({ where: { id: planId }, data: { status: "MATERIAL_RESERVED", revision, materialReservedById: actorId || null, materialReservedAt: now, commandId: command.id } });
    await outbox(tx, {
      eventType: "production.plan.material_reserved", aggregateType: "ProductionRunPlan", aggregateId: planId, revision,
      dedupeKey: `production-plan-material-reserved:${planId}:${revision}`,
      payload: { planId, runId: plan.runId, unitId: plan.run.unitId, reservations, revision, occurredAt: now.toISOString(), actorId },
    });
    await recordActivity(tx, {
      entityType: "unit", entityId: plan.run.unitId, eventType: EVENT_TYPES.PRODUCTION_PLAN_MATERIAL_RESERVED, actorId: actorId || null,
      metadata: { unitCode: plan.run.unit.unitCode, planId, reservationCount: reservations.length },
    });
    const response = { planId, status: "MATERIAL_RESERVED", revision, reservations };
    await finishCommand(tx, command, revision, response);
    return { replayed: false, ...response };
  });
}

// ---------------------------------------------------------------------------
// 5. Lepas reservasi manual (tanpa mengubah BOM) — idempoten/no-op aman bila tidak ada reservasi aktif.
// ---------------------------------------------------------------------------
// Mutasi murni (TANPA v2Command sendiri) — dipakai ULANG oleh releaseMaterialReservations (di bawah, membungkusnya
// dengan command RELEASE_RESERVATIONS sendiri) DAN oleh productionMaterialIssueCommandService.js (P4) saat
// pembatalan permintaan bahan sebelum PICKED, di dalam TRANSAKSI YANG SAMA dengan command CANCEL_MATERIAL_ISSUE
// milik P4 — nested prisma.$transaction tidak didukung, jadi bagian mutasi harus bisa dipanggil dengan `tx` polos.
// `plan` HARUS sudah dimuat+dikunci (loadPlanForWrite) oleh pemanggil.
export async function releaseReservationsInTx(tx, { plan, actorId, reason, commandId }) {
  const now = new Date();
  let released = 0;
  for (const reservation of plan.reservations) {
    const nextRevision = reservation.revision + 1;
    await tx.materialReservation.update({
      where: { id: reservation.id },
      data: { status: "RELEASED", releasedById: actorId || null, releasedAt: now, releaseReason: reason, revision: nextRevision },
    });
    await outbox(tx, {
      eventType: "production.reservation.released", aggregateType: "MaterialReservation", aggregateId: reservation.id, revision: nextRevision,
      dedupeKey: `production-reservation-released:${reservation.id}:${nextRevision}`,
      payload: { reservationId: reservation.id, planId: plan.id, materialId: reservation.materialId, reason, occurredAt: now.toISOString(), actorId },
    });
    released += 1;
  }
  const nextStatus = plan.status === "MATERIAL_RESERVED" ? "PLANNED" : plan.status;
  const revision = plan.revision + 1;
  await tx.productionRunPlan.update({ where: { id: plan.id }, data: { status: nextStatus, revision, commandId } });
  return { releasedCount: released, nextStatus, revision };
}

export async function releaseMaterialReservations(prisma, { planId, actorId, idempotencyKey, expectedRevision, reason }) {
  assertIdempotencyKey(idempotencyKey);
  const revisionExpected = assertExpectedRevision(expectedRevision);
  const cleaned = String(reason ?? "").trim();
  if (cleaned.length < 3) throw planError("Alasan pelepasan reservasi wajib diisi (minimal 3 karakter)", 400, "PLAN_RELEASE_REASON_REQUIRED");
  const actor = actorId || "SYSTEM";
  const requestHash = hash({ commandType: "RELEASE_RESERVATIONS", planId, expectedRevision: revisionExpected, reason: cleaned });

  return prisma.$transaction(async (tx) => {
    const replay = await findReplay(tx, actor, idempotencyKey, requestHash);
    if (replay) return replay;
    const plan = await loadPlanForWrite(tx, planId);
    assertPlanNotCancelled(plan);
    assertPlanRevision(plan, revisionExpected);
    await assertWriterEnabledForUnit(tx, plan.run.unitId);
    await assertNoBlockingMaterialIssue(tx, planId);

    const command = await beginCommand(tx, { actor, idempotencyKey, commandType: "RELEASE_RESERVATIONS", aggregateType: "ProductionRunPlan", aggregateId: planId, requestHash, expectedRevision: revisionExpected });
    const { releasedCount, nextStatus, revision } = await releaseReservationsInTx(tx, { plan, actorId, reason: cleaned, commandId: command.id });
    const response = { planId, status: nextStatus, revision, releasedCount };
    await finishCommand(tx, command, revision, response);
    return { replayed: false, ...response };
  });
}

// ---------------------------------------------------------------------------
// 6. Batalkan rencana (terminal) — melepas reservasi aktif dan membatalkan baris BOM aktif dalam transaksi yang sama.
// ---------------------------------------------------------------------------
export async function cancelProductionPlan(prisma, { planId, actorId, idempotencyKey, expectedRevision, reason }) {
  assertIdempotencyKey(idempotencyKey);
  const revisionExpected = assertExpectedRevision(expectedRevision);
  const cleaned = String(reason ?? "").trim();
  if (cleaned.length < 3) throw planError("Alasan pembatalan wajib diisi (minimal 3 karakter)", 400, "PLAN_CANCEL_REASON_REQUIRED");
  const actor = actorId || "SYSTEM";
  const requestHash = hash({ commandType: "CANCEL_PLAN", planId, expectedRevision: revisionExpected, reason: cleaned });

  return prisma.$transaction(async (tx) => {
    const replay = await findReplay(tx, actor, idempotencyKey, requestHash);
    if (replay) return replay;
    const plan = await loadPlanForWrite(tx, planId);
    assertPlanNotCancelled(plan);
    assertPlanRevision(plan, revisionExpected);
    await assertWriterEnabledForUnit(tx, plan.run.unitId);
    await assertNoBlockingMaterialIssue(tx, planId);

    const now = new Date();
    for (const reservation of plan.reservations) {
      const nextRevision = reservation.revision + 1;
      await tx.materialReservation.update({
        where: { id: reservation.id },
        data: { status: "CANCELLED", releasedById: actorId || null, releasedAt: now, releaseReason: cleaned, revision: nextRevision },
      });
    }
    for (const line of plan.bomLines) {
      await tx.plannedBOMLine.update({ where: { id: line.id }, data: { status: "CANCELLED", supersededById: actorId || null, supersededAt: now, revision: line.revision + 1 } });
    }
    const revision = plan.revision + 1;
    const command = await beginCommand(tx, { actor, idempotencyKey, commandType: "CANCEL_PLAN", aggregateType: "ProductionRunPlan", aggregateId: planId, requestHash, expectedRevision: revisionExpected });
    await tx.productionRunPlan.update({ where: { id: planId }, data: { status: "CANCELLED", revision, cancelledById: actorId || null, cancelledAt: now, cancelReason: cleaned, commandId: command.id } });
    await outbox(tx, {
      eventType: "production.plan.cancelled", aggregateType: "ProductionRunPlan", aggregateId: planId, revision,
      dedupeKey: `production-plan-cancelled:${planId}:${revision}`,
      payload: { planId, runId: plan.runId, unitId: plan.run.unitId, reason: cleaned, revision, occurredAt: now.toISOString(), actorId },
    });
    await recordActivity(tx, {
      entityType: "unit", entityId: plan.run.unitId, eventType: EVENT_TYPES.PRODUCTION_PLAN_CANCELLED, actorId: actorId || null,
      metadata: { unitCode: plan.run.unit.unitCode, planId, reason: cleaned },
    });
    const response = { planId, status: "CANCELLED", revision };
    await finishCommand(tx, command, revision, response);
    return { replayed: false, ...response };
  });
}

// ---------------------------------------------------------------------------
// Bacaan (digerbang flag reader di layer routes, bukan di sini — sama pola dengan custody).
// ---------------------------------------------------------------------------
export async function listEligibleUnitsForPlanning(prisma, { unitIds = null, limit = 100 } = {}) {
  const runs = await prisma.productionRun.findMany({
    where: {
      status: { notIn: ["COMPLETED", "CANCELLED"] },
      plan: { is: null },
      OR: [
        { custodyHandoffs: { some: { direction: "INBOUND", status: "ACCEPTED" } } },
        { migrationSource: { not: null } },
      ],
      ...(unitIds ? { unitId: { in: unitIds } } : {}),
    },
    include: {
      unit: { select: { id: true, unitCode: true, merk: true, ukuran: true, storageLocation: true, order: { select: { orderNumber: true } } } },
      phases: { where: { phase: "PROCESS" }, select: { status: true } },
    },
    orderBy: [{ createdAt: "asc" }],
    take: Math.min(Math.max(Number(limit) || 100, 1), 200),
  });
  return runs
    .filter((run) => !run.phases[0] || !["ACTIVE", "COMPLETED"].includes(run.phases[0].status))
    .map((run) => ({
      runId: run.id, unit: { id: run.unit.id, unitCode: run.unit.unitCode, merk: run.unit.merk, ukuran: run.unit.ukuran, storageLocation: run.unit.storageLocation, orderNumber: run.unit.order?.orderNumber ?? null },
      kind: run.kind, isLegacyException: !!run.migrationSource,
    }));
}

const PLAN_LIST_INCLUDE = {
  run: { select: { id: true, unitId: true, kind: true, unit: { select: { id: true, unitCode: true, merk: true, ukuran: true, order: { select: { orderNumber: true } } } } } },
  workCenter: { select: { id: true, code: true, name: true } },
  operator: { select: { id: true, userId: true, employeeCode: true } },
  bomLines: { where: { status: "ACTIVE" }, include: { material: { select: { code: true, name: true, unit: true } } } },
  reservations: { where: { status: "ACTIVE" }, select: { id: true, materialId: true, qty: true, reservedAt: true } },
};

export async function listProductionPlans(prisma, { status = null, unitIds = null, limit = 100 } = {}) {
  const rows = await prisma.productionRunPlan.findMany({
    where: { ...(status ? { status } : {}), ...(unitIds ? { run: { unitId: { in: unitIds } } } : {}) },
    include: PLAN_LIST_INCLUDE,
    orderBy: [{ updatedAt: "desc" }],
    take: Math.min(Math.max(Number(limit) || 100, 1), 200),
  });
  return rows.map(formatPlan);
}

export async function getProductionPlan(prisma, planId) {
  const row = await prisma.productionRunPlan.findUnique({ where: { id: planId }, include: PLAN_LIST_INCLUDE });
  return row ? formatPlan(row) : null;
}

function formatPlan(row) {
  return {
    id: row.id, runId: row.runId, status: row.status, revision: row.revision,
    unit: { id: row.run.unit.id, unitCode: row.run.unit.unitCode, merk: row.run.unit.merk, ukuran: row.run.unit.ukuran, orderNumber: row.run.unit.order?.orderNumber ?? null },
    workCenter: row.workCenter, operator: row.operator,
    targetStartAt: row.targetStartAt, targetCompleteAt: row.targetCompleteAt,
    plannedAt: row.plannedAt, materialReservedAt: row.materialReservedAt, cancelledAt: row.cancelledAt, cancelReason: row.cancelReason,
    bomLines: row.bomLines.map((l) => ({ id: l.id, materialId: l.materialId, code: l.material.code, name: l.material.name, qty: Number(l.qty), unit: l.unit })),
    reservations: row.reservations.map((r) => ({ id: r.id, materialId: r.materialId, qty: Number(r.qty), reservedAt: r.reservedAt })),
    updatedAt: row.updatedAt,
  };
}
