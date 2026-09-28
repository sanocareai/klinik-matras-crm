// Command owner Pengambilan Bahan Produksi (Production Workshop + Warehouse V2, slice P4).
// Penulis TUNGGAL untuk Material Issue yang dimiliki V2 (material_issues.production_plan_id terisi) — endpoint V1
// (routes/materialIssue.js) menolak memutasi dokumen itu (assertNotOwnedByV2). Lihat
// scripts/production-delivery-v2/audit-material-issue-writers.js.
//
// Kontrak:
//  - Request HANYA dari Production Plan MATERIAL_RESERVED; material+qty SELALU dari reservasi P3 (client tidak
//    mengirim baris apa pun). Satu issue AKTIF per plan (partial unique index + pra-cek).
//  - Dokumen memakai tabel v1 material_issues/material_issue_lines (bukan ledger/saldo paralel). Status memakai enum
//    IssueStatus yang ada: dibuat di READY_TO_PICK (reservasi P3 = persetujuan), Gudang "Serahkan Bahan" -> ISSUED.
//  - PICKED atomik dalam SATU transaksi: kunci dokumen -> per material (materialId ascending) postStockMovement
//    (ledger kanonis; menolak saldo negatif) -> issuedQty -> reservasi CONSUMED -> issue ISSUED -> HPP lewat
//    postMaterialIssueCost (jalur kanonis; idempoten per materialIssueId, TIDAK ditulis dua kali).
//  - Stok fisik baru berkurang saat PICKED, bukan saat request. Tidak ada partial pick: qty keluar = qty reservasi.
//  - Setelah ISSUED tidak ada cancel/delete; koreksi lewat return/adjustment kanonis (di luar slice ini).
//  - Batal sebelum PICKED: issue CANCELLED + reservasi dilepas (releaseReservationsInTx, plan kembali PLANNED).
//  - Writer di balik flag production_v2_writer (cohort unitIds, fail-closed). TIDAK menyentuh ProductionRun/fase PROCESS.
import { createHash } from "node:crypto";
import { recordActivity, EVENT_TYPES } from "../lib/activityLog.js";
import { LedgerError, lockRowForUpdate, postStockMovement } from "./inventoryLedger.js";
import { postMaterialIssueCost } from "./finance/posting/inventory.js";
import { JournalError } from "./finance/journal.js";
import { AccountError } from "./finance/accounts.js";
import { cancelSupplementalInTx, loadPlanForWrite, releaseReservationsInTx } from "./productionPlanningCommandService.js";
import { generateIssueCode } from "../routes/materialIssue.js";
import { isProductionWriterEnabledFor, loadV2Flags, resolveProductionWriterState } from "./v2FeatureFlags.js";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{12,128}$/;

function issueError(message, statusCode, code, details) {
  return Object.assign(new Error(message), { statusCode, code, ...(details ? { details } : {}) });
}
const hash = (value) => createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");

export function assertIdempotencyKey(key) {
  if (!key || !IDEMPOTENCY_KEY.test(key)) throw issueError("Idempotency-Key wajib diisi (12-128 karakter)", 400, "IDEMPOTENCY_KEY_INVALID");
}
export function assertExpectedRevision(value) {
  const revision = Number(value);
  if (value == null || value === "" || !Number.isInteger(revision) || revision < 1) {
    throw issueError("expectedRevision wajib diisi (angka bulat positif)", 400, "EXPECTED_REVISION_REQUIRED");
  }
  return revision;
}
// Aturan transisi murni (diuji unit).
export function assertIssueRevision(issue, expectedRevision) {
  if (issue.revision !== expectedRevision) {
    throw issueError(`Revisi permintaan berubah: diharapkan ${expectedRevision}, sekarang ${issue.revision}. Muat ulang.`, 409, "MATERIAL_ISSUE_REVISION_CONFLICT", { revision: issue.revision });
  }
}
export function assertIssuePickable(issue) {
  if (issue.status === "ISSUED") throw issueError("Bahan untuk permintaan ini sudah diserahkan", 409, "MATERIAL_ISSUE_ALREADY_PICKED", { status: issue.status });
  if (issue.status === "CANCELLED") throw issueError("Permintaan ini sudah dibatalkan", 409, "MATERIAL_ISSUE_CANCELLED", { status: issue.status });
  if (issue.status !== "READY_TO_PICK") throw issueError(`Permintaan berstatus ${issue.status}; tidak dapat diserahkan`, 409, "MATERIAL_ISSUE_NOT_READY", { status: issue.status });
}
export function assertIssueCancellable(issue) {
  if (issue.status === "ISSUED") throw issueError("Bahan sudah diserahkan; pembatalan tidak diizinkan — koreksi lewat return/adjustment stok", 409, "MATERIAL_ISSUE_ALREADY_PICKED", { status: issue.status });
  if (issue.status === "CANCELLED") throw issueError("Permintaan ini sudah dibatalkan", 409, "MATERIAL_ISSUE_CANCELLED", { status: issue.status });
}

async function beginCommand(tx, { actor, idempotencyKey, commandType, aggregateId, requestHash, expectedRevision = null }) {
  return tx.v2Command.create({
    data: { domain: "WAREHOUSE", actorId: actor, idempotencyKey, commandType, aggregateType: "MaterialIssue", aggregateId, expectedRevision, requestHash },
  });
}
async function finishCommand(tx, command, appliedRevision, response) {
  await tx.v2Command.update({ where: { id: command.id }, data: { status: "APPLIED", appliedRevision, response, completedAt: new Date() } });
}
async function outbox(tx, { eventType, aggregateType = "MaterialIssue", aggregateId, revision, dedupeKey, payload }) {
  return tx.domainOutbox.create({ data: { domain: "WAREHOUSE", eventType, aggregateType, aggregateId, aggregateRevision: revision, dedupeKey, payload } });
}
async function findReplay(tx, actor, idempotencyKey, requestHash) {
  const replay = await tx.v2Command.findUnique({ where: { actorId_idempotencyKey: { actorId: actor, idempotencyKey } } });
  if (!replay) return null;
  if (replay.requestHash !== requestHash) throw issueError("Idempotency-Key dipakai untuk payload berbeda", 409, "IDEMPOTENCY_CONFLICT");
  if (replay.status !== "APPLIED") throw issueError("Command masih diproses", 409, "COMMAND_IN_PROGRESS");
  return { replayed: true, ...replay.response };
}
async function assertWriterEnabledForUnit(tx, unitId) {
  const state = resolveProductionWriterState(await loadV2Flags(tx));
  if (!isProductionWriterEnabledFor(state, unitId)) {
    throw issueError("Pengambilan bahan V2 tidak aktif untuk unit ini; gunakan alur lama", 503, "MATERIAL_ISSUE_WRITER_OFF");
  }
}

const ISSUE_INCLUDE = {
  lines: { include: { material: { select: { id: true, code: true, name: true, unit: true } }, reservation: { select: { id: true, status: true, qty: true } } } },
  unit: { select: { id: true, unitCode: true, order: { select: { orderNumber: true } } } },
  productionPlan: { select: { id: true, status: true, revision: true } },
};

async function loadIssueForWrite(tx, issueId) {
  await lockRowForUpdate(tx, "material_issues", issueId);
  const issue = await tx.materialIssue.findUnique({ where: { id: issueId }, include: ISSUE_INCLUDE });
  if (!issue || !issue.productionPlanId) throw issueError("Permintaan pengambilan bahan tidak ditemukan", 404, "MATERIAL_ISSUE_NOT_FOUND");
  return issue;
}

// ---------------------------------------------------------------------------
// 1. Production mengajukan pengambilan bahan dari Plan MATERIAL_RESERVED.
// ---------------------------------------------------------------------------
export async function requestMaterialPickup(prisma, { planId, actorId, idempotencyKey }) {
  if (!planId) throw issueError("planId wajib diisi", 400, "MATERIAL_ISSUE_PLAN_REQUIRED");
  assertIdempotencyKey(idempotencyKey);
  const actor = actorId || "SYSTEM";
  const requestHash = hash({ commandType: "REQUEST_MATERIAL_PICKUP", planId });

  return prisma.$transaction(async (tx) => {
    // Urutan kunci: plan (P3) lebih dulu — sama dengan command P3, tidak ada siklus dengan dokumen issue.
    const plan = await loadPlanForWrite(tx, planId);
    const replay = await findReplay(tx, actor, idempotencyKey, requestHash);
    if (replay) return replay;
    await assertWriterEnabledForUnit(tx, plan.run.unitId);
    if (plan.status !== "MATERIAL_RESERVED") {
      throw issueError("Pengambilan bahan hanya dapat diajukan dari rencana berstatus Bahan Direservasi", 409, "PLAN_NOT_MATERIAL_RESERVED", { status: plan.status });
    }
    if (plan.reservations.length === 0) throw issueError("Rencana tidak memiliki reservasi aktif", 422, "PLAN_NO_ACTIVE_RESERVATIONS");
    const active = await tx.materialIssue.findFirst({ where: { productionPlanId: planId, status: { notIn: ["ISSUED", "CANCELLED"] } }, select: { id: true } });
    if (active) throw issueError("Sudah ada permintaan pengambilan bahan aktif untuk rencana ini", 409, "MATERIAL_ISSUE_ALREADY_ACTIVE", { issueId: active.id });
    const issued = await tx.materialIssue.findFirst({ where: { productionPlanId: planId, status: "ISSUED" }, select: { id: true } });
    if (issued) throw issueError("Bahan untuk rencana ini sudah pernah diserahkan", 409, "MATERIAL_ISSUE_ALREADY_PICKED", { issueId: issued.id });

    const now = new Date();
    const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const existing = await tx.materialIssue.count({ where: { createdAt: { gte: startOfDay } } });
    const issueNumber = `${generateIssueCode(now)}-${String(existing + 1).padStart(2, "0")}`;
    // Urutan baris deterministik (materialId ascending) — dipakai ulang saat PICKED.
    const reservations = [...plan.reservations].sort((a, b) => a.materialId.localeCompare(b.materialId));

    const command = await beginCommand(tx, { actor, idempotencyKey, commandType: "REQUEST_MATERIAL_PICKUP", aggregateId: planId, requestHash });
    const issue = await tx.materialIssue.create({
      data: {
        issueNumber, sourceType: "PRODUCTION_WORK_ORDER", unitId: plan.run.unitId, productionPlanId: planId,
        sourceReference: `Rencana Produksi ${plan.run.unit.unitCode}`, department: "PRODUKSI",
        requestedById: actorId || null, createdById: actorId || null, status: "READY_TO_PICK", revision: 1, commandId: command.id,
        lines: { create: reservations.map((r) => ({ materialId: r.materialId, requestedQty: Number(r.qty), reservationId: r.id })) },
      },
    });
    await outbox(tx, {
      eventType: "warehouse.material_issue.requested", aggregateId: issue.id, revision: 1, dedupeKey: `warehouse-material-issue-requested:${issue.id}`,
      payload: { issueId: issue.id, issueNumber, planId, runId: plan.runId, unitId: plan.run.unitId, lineCount: reservations.length, occurredAt: now.toISOString(), actorId },
    });
    await recordActivity(tx, {
      entityType: "unit", entityId: plan.run.unitId, eventType: EVENT_TYPES.PRODUCTION_MATERIAL_ISSUE_REQUESTED, actorId: actorId || null,
      metadata: { unitCode: plan.run.unit.unitCode, issueNumber, planId, lineCount: reservations.length },
    });
    const response = { issueId: issue.id, issueNumber, planId, status: "READY_TO_PICK", revision: 1, lineCount: reservations.length };
    await finishCommand(tx, command, 1, response);
    return { replayed: false, ...response };
  });
}

// ---------------------------------------------------------------------------
// P6. Permintaan bahan TAMBAHAN rework: dokumen Material Issue baru (READY_TO_PICK) yang terhubung ke inspeksi QC gagal dan ke
// reservasi tambahan (reserveSupplementalInTx, P3). Dipanggil command QC V2 di transaksinya sendiri; `plan` sudah dikunci. Serah bahan,
// stock movement, dan HPP memakai pickMaterialIssue di bawah — jalur yang SAMA, tidak ada ledger paralel.
// ---------------------------------------------------------------------------
export async function createSupplementalIssueInTx(tx, { plan, inspectionId, reservations, actorId, commandId }) {
  if (!reservations?.length) throw issueError("Bahan tambahan wajib memuat minimal satu bahan", 400, "MATERIAL_ISSUE_SUPPLEMENTAL_EMPTY");
  const now = new Date();
  const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const existing = await tx.materialIssue.count({ where: { createdAt: { gte: startOfDay } } });
  const issueNumber = `${generateIssueCode(now)}-${String(existing + 1).padStart(2, "0")}`;
  const sorted = [...reservations].sort((a, b) => a.materialId.localeCompare(b.materialId));
  const issue = await tx.materialIssue.create({
    data: {
      issueNumber, sourceType: "PRODUCTION_WORK_ORDER", unitId: plan.run.unitId, productionPlanId: plan.id, reworkInspectionId: inspectionId,
      sourceReference: `Bahan tambahan rework ${plan.run.unit.unitCode}`, department: "PRODUKSI",
      requestedById: actorId || null, createdById: actorId || null, status: "READY_TO_PICK", revision: 1, commandId,
      lines: { create: sorted.map((r) => ({ materialId: r.materialId, requestedQty: Number(r.qty), reservationId: r.reservationId })) },
    },
  });
  await outbox(tx, {
    eventType: "warehouse.material_issue.requested", aggregateId: issue.id, revision: 1, dedupeKey: `warehouse-material-issue-requested:${issue.id}`,
    payload: { issueId: issue.id, issueNumber, planId: plan.id, runId: plan.runId, unitId: plan.run.unitId, lineCount: sorted.length, reworkInspectionId: inspectionId, occurredAt: now.toISOString(), actorId },
  });
  await recordActivity(tx, {
    entityType: "unit", entityId: plan.run.unitId, eventType: EVENT_TYPES.PRODUCTION_MATERIAL_ISSUE_REQUESTED, actorId: actorId || null,
    metadata: { unitCode: plan.run.unit.unitCode, issueNumber, planId: plan.id, lineCount: sorted.length, supplemental: true },
  });
  return { issueId: issue.id, issueNumber, status: "READY_TO_PICK", revision: 1, lineCount: sorted.length };
}

// ---------------------------------------------------------------------------
// 2. Gudang "Serahkan Bahan" (PICKED): stok fisik berkurang + reservasi CONSUMED + issue terminal, atomik.
// ---------------------------------------------------------------------------
export async function pickMaterialIssue(prisma, { issueId, actorId, idempotencyKey, expectedRevision }) {
  if (!issueId) throw issueError("issueId wajib diisi", 400, "MATERIAL_ISSUE_ID_REQUIRED");
  assertIdempotencyKey(idempotencyKey);
  const revisionExpected = assertExpectedRevision(expectedRevision);
  const actor = actorId || "SYSTEM";
  const requestHash = hash({ commandType: "PICK_MATERIAL_ISSUE", issueId, expectedRevision: revisionExpected });

  return prisma.$transaction(async (tx) => {
    const issue = await loadIssueForWrite(tx, issueId);
    const replay = await findReplay(tx, actor, idempotencyKey, requestHash);
    if (replay) return replay;
    await assertWriterEnabledForUnit(tx, issue.unitId);
    assertIssuePickable(issue);
    assertIssueRevision(issue, revisionExpected);

    const now = new Date();
    const revision = issue.revision + 1;
    const command = await beginCommand(tx, { actor, idempotencyKey, commandType: "PICK_MATERIAL_ISSUE", aggregateId: issueId, requestHash, expectedRevision: revisionExpected });
    // Urutan kunci deterministik per materialId (ascending); postStockMovement mengunci baris `materials` + saldo.
    const lines = [...issue.lines].sort((a, b) => a.materialId.localeCompare(b.materialId));
    for (const line of lines) {
      if (!line.reservationId || line.reservation?.status !== "ACTIVE") {
        throw issueError(`Reservasi bahan ${line.material.code} tidak lagi aktif`, 409, "MATERIAL_ISSUE_RESERVATION_INACTIVE", { materialId: line.materialId });
      }
      try {
        await postStockMovement(tx, {
          materialId: line.materialId, type: "ISSUE", qty: -line.requestedQty, unitId: issue.unitId || undefined,
          note: `Pengambilan bahan produksi ${issue.issueNumber}`, materialIssueId: issue.id, createdById: actorId || undefined,
        });
      } catch (e) {
        if (e instanceof LedgerError) throw issueError(e.message, 409, "MATERIAL_ISSUE_SHORTAGE", { materialId: line.materialId });
        throw e;
      }
      await tx.materialIssueLine.update({ where: { id: line.id }, data: { issuedQty: line.requestedQty } });
      await tx.materialReservation.update({
        where: { id: line.reservationId },
        data: { status: "CONSUMED", consumedById: actorId || null, consumedAt: now, revision: { increment: 1 } },
      });
    }
    await tx.materialIssue.update({
      where: { id: issue.id },
      data: { status: "ISSUED", issuedById: actorId || null, issuedAt: now, revision, commandId: command.id },
    });
    // HPP/perpetual lewat jalur kanonis D-180 — idempoten per materialIssueId; error "data belum lengkap" tidak
    // boleh menggagalkan serah-terima fisik (pola sama dengan POST /material-issues/:id/issue di V1).
    try {
      await postMaterialIssueCost(tx, { materialIssueId: issue.id, userId: actorId || null });
    } catch (e) {
      if (!(e instanceof JournalError) && !(e instanceof AccountError)) throw e;
    }
    await outbox(tx, {
      eventType: "warehouse.material_issue.picked", aggregateId: issue.id, revision, dedupeKey: `warehouse-material-issue-picked:${issue.id}:${revision}`,
      payload: { issueId: issue.id, issueNumber: issue.issueNumber, planId: issue.productionPlanId, unitId: issue.unitId, lines: lines.map((l) => ({ materialId: l.materialId, qty: l.requestedQty })), revision, occurredAt: now.toISOString(), actorId },
    });
    await recordActivity(tx, {
      entityType: "unit", entityId: issue.unitId, eventType: EVENT_TYPES.PRODUCTION_MATERIAL_ISSUE_PICKED, actorId: actorId || null,
      metadata: { unitCode: issue.unit?.unitCode, issueNumber: issue.issueNumber, lineCount: lines.length },
    });
    const response = { issueId: issue.id, issueNumber: issue.issueNumber, status: "ISSUED", revision, lineCount: lines.length };
    await finishCommand(tx, command, revision, response);
    return { replayed: false, ...response };
  });
}

// ---------------------------------------------------------------------------
// 3. Batal sebelum PICKED: issue CANCELLED + reservasi dilepas (plan kembali PLANNED), satu transaksi.
// ---------------------------------------------------------------------------
export async function cancelMaterialIssueBeforePick(prisma, { issueId, actorId, idempotencyKey, expectedRevision, reason }) {
  if (!issueId) throw issueError("issueId wajib diisi", 400, "MATERIAL_ISSUE_ID_REQUIRED");
  assertIdempotencyKey(idempotencyKey);
  const revisionExpected = assertExpectedRevision(expectedRevision);
  const cleaned = String(reason ?? "").trim();
  if (cleaned.length < 3) throw issueError("Alasan pembatalan wajib diisi (minimal 3 karakter)", 400, "MATERIAL_ISSUE_CANCEL_REASON_REQUIRED");
  const actor = actorId || "SYSTEM";
  const requestHash = hash({ commandType: "CANCEL_MATERIAL_ISSUE", issueId, expectedRevision: revisionExpected, reason: cleaned });

  return prisma.$transaction(async (tx) => {
    // Urutan kunci SAMA dengan request: plan lebih dulu, lalu dokumen issue.
    const pre = await tx.materialIssue.findUnique({ where: { id: issueId }, select: { productionPlanId: true } });
    if (!pre?.productionPlanId) throw issueError("Permintaan pengambilan bahan tidak ditemukan", 404, "MATERIAL_ISSUE_NOT_FOUND");
    const plan = await loadPlanForWrite(tx, pre.productionPlanId);
    const issue = await loadIssueForWrite(tx, issueId);
    const replay = await findReplay(tx, actor, idempotencyKey, requestHash);
    if (replay) return replay;
    await assertWriterEnabledForUnit(tx, issue.unitId);
    assertIssueCancellable(issue);
    assertIssueRevision(issue, revisionExpected);

    const now = new Date();
    const revision = issue.revision + 1;
    const command = await beginCommand(tx, { actor, idempotencyKey, commandType: "CANCEL_MATERIAL_ISSUE", aggregateId: issueId, requestHash, expectedRevision: revisionExpected });
    await tx.materialIssue.update({
      where: { id: issue.id },
      data: { status: "CANCELLED", cancelledById: actorId || null, cancelledAt: now, cancelReason: cleaned, revision, commandId: command.id },
    });
    // Issue TAMBAHAN rework: hanya reservasi tambahan yang dilepas; plan tetap Bahan Direservasi (reservasi asli CONSUMED tidak disentuh).
    const { releasedCount, nextStatus } = issue.reworkInspectionId
      ? { ...(await cancelSupplementalInTx(tx, { plan, inspectionId: issue.reworkInspectionId, actorId, reason: `Permintaan bahan tambahan ${issue.issueNumber} dibatalkan: ${cleaned}` })), nextStatus: plan.status }
      : await releaseReservationsInTx(tx, { plan, actorId, commandId: command.id, reason: `Permintaan pengambilan bahan ${issue.issueNumber} dibatalkan: ${cleaned}` });
    await outbox(tx, {
      eventType: "warehouse.material_issue.cancelled", aggregateId: issue.id, revision, dedupeKey: `warehouse-material-issue-cancelled:${issue.id}:${revision}`,
      payload: { issueId: issue.id, issueNumber: issue.issueNumber, planId: plan.id, unitId: issue.unitId, reason: cleaned, releasedReservations: releasedCount, revision, occurredAt: now.toISOString(), actorId },
    });
    await recordActivity(tx, {
      entityType: "unit", entityId: issue.unitId, eventType: EVENT_TYPES.PRODUCTION_MATERIAL_ISSUE_CANCELLED, actorId: actorId || null,
      metadata: { unitCode: issue.unit?.unitCode, issueNumber: issue.issueNumber, reason: cleaned },
    });
    const response = { issueId: issue.id, issueNumber: issue.issueNumber, status: "CANCELLED", revision, releasedReservations: releasedCount, planStatus: nextStatus };
    await finishCommand(tx, command, revision, response);
    return { replayed: false, ...response };
  });
}

// ---------------------------------------------------------------------------
// Bacaan (digerbang flag reader di layer routes).
// ---------------------------------------------------------------------------
function formatIssue(row) {
  return {
    id: row.id, issueNumber: row.issueNumber, status: row.status, revision: row.revision,
    planId: row.productionPlanId, planStatus: row.productionPlan?.status ?? null,
    supplemental: Boolean(row.reworkInspectionId), reworkInspectionId: row.reworkInspectionId ?? null,
    unit: row.unit ? { id: row.unit.id, unitCode: row.unit.unitCode, orderNumber: row.unit.order?.orderNumber ?? null } : null,
    createdAt: row.createdAt, issuedAt: row.issuedAt, cancelledAt: row.cancelledAt, cancelReason: row.cancelReason,
    lines: row.lines.map((l) => ({
      id: l.id, materialId: l.materialId, code: l.material.code, name: l.material.name, unit: l.material.unit,
      planned: Number(l.requestedQty), reserved: l.reservation ? Number(l.reservation.qty) : 0,
      reservationStatus: l.reservation?.status ?? null, picked: l.issuedQty ?? 0,
    })),
  };
}

export async function listMaterialRequests(prisma, { status = null, unitIds = null, planId = null, limit = 100 } = {}) {
  const rows = await prisma.materialIssue.findMany({
    where: {
      productionPlanId: planId ? planId : { not: null },
      ...(status ? { status } : {}),
      ...(unitIds ? { unitId: { in: unitIds } } : {}),
    },
    include: ISSUE_INCLUDE,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: Math.min(Math.max(Number(limit) || 100, 1), 200),
  });
  return rows.map(formatIssue);
}

export async function getMaterialRequest(prisma, issueId) {
  const row = await prisma.materialIssue.findUnique({ where: { id: issueId }, include: ISSUE_INCLUDE });
  return row && row.productionPlanId ? formatIssue(row) : null;
}
