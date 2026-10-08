// Command owner Eksekusi Workshop (Production Workshop + Warehouse V2, slice P5).
// Penulis TUNGGAL production_operation_runs_v2 dan penulis fase PROCESS/QC-run untuk eksekusi; juga satu-satunya jalur kanonis
// pembuatan Production Run "WORKSHOP_BORN" (unit BARU/SEWA tanpa pickup). Lihat
// scripts/production-delivery-v2/audit-workshop-execution-writers.js.
//
// Kontrak:
//  - REUSE stage engine V1 (unitStageEngine.js *InTx): transisi START/PAUSE/RESUME/COMPLETE + ledger unit_stage_logs +
//    unit.currentStageId/status ditulis engine yang sama (proyeksi V1) di TRANSAKSI YANG SAMA dengan command V2. Tidak ada
//    ledger tahap paralel. Engine V1 menolak (409) memutasi unit yang dikelola V2 (assertNotV2ExecutionOwned).
//  - Tahap routing INTAKE (uji sebelum bongkar, bongkar, uji fondasi, diagnosa) boleh berjalan setelah rencana DITUGASKAN (PLANNED) —
//    BOM baru dibuat setelah diagnosa nyata (P8). Tahap MODULE ke atas HANYA dimulai bila material P4 sudah ISSUED dan seluruh
//    reservasi P3 sudah CONSUMED.
//  - Operator/work center wajib sama dengan assignment P3 (plan.operatorId/workCenterId); aktor = operator yang ditugaskan. Tahap SETELAH
//    gerbang QC (Jahit Corner, Finish) memakai PIC Corner bila rencana menugaskannya (plan.cornerOperatorId/cornerWorkCenterId).
//  - Inti transisi (prepareStartInTx/applyStartInTx/applyCompleteInTx/applyPauseInTx/applyResumeInTx) diekspor untuk command bukti tahap
//    P8 (productionStepCommandService.js) supaya bukti + transisi commit di SATU transaksi; penulis tabel operasi tetap file ini.
//  - Satu tahap AKTIF (ACTIVE/PAUSED) per Run: pra-cek + partial unique index. Urutan tahap = jalur routing V1.
//  - Jeda wajib alasan (validatePauseReason); foto/catatan disimpan di ledger tahap (evidence).
//  - Menyelesaikan tahap workshop TERAKHIR (tahap berikutnya di jalur = gerbang QC) -> AWAITING_QC: fase PROCESS COMPLETED,
//    currentPhase=QC, unit.currentStageId=gerbang QC (antrean QC V1). TIDAK PERNAH PASS QC / READY_FOR_DELIVERY (P6).
//  - P5 TIDAK menulis stock_movements, reservasi, atau HPP/jurnal (diaudit).
//  - Writer di balik production_v2_writer (cohort unitIds, fail-closed); reader production_v2_reader menggerbang bacaan.
import { createHash } from "node:crypto";
import { PERMISSIONS as P } from "../constants/permissions.js";
import { hasPermission } from "../middleware/authorize.js";
import { recordActivity, EVENT_TYPES } from "../lib/activityLog.js";
import { validatePauseReason } from "../lib/domain/stageExecution.js";
import { isLastStage } from "../lib/domain/routing.js";
import { lockRowForUpdate } from "./inventoryLedger.js";
import { completeAdaptationRunInTx, offerFinishedGoodsCustodyInTx } from "./unitCustodyCommandService.js";
import { assertNoOpenRunException, assertNoV1Drift } from "./productionRunGuards.js";
import { lockUnitOwnership } from "./unitV2Ownership.js";
import {
  completeStageInTx, pathForUnit, pauseStageInTx, resolveCurrentTarget, resumeStageInTx, skipStageForAdaptationInTx, startStageInTx,
} from "./unitStageEngine.js";
import { PHASE_TERMINAL_STATUSES, isStrictLifecycleRun, transitionPhases } from "./productionPhaseLifecycle.js";
import { isProductionWriterEnabledFor, loadV2Flags, resolveProductionWriterState } from "./v2FeatureFlags.js";
import { ADAPTATION_POLICY, defaultAdaptationPolicy } from "./productionSettingsService.js";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{12,128}$/;
const TERMINAL_RUN = ["COMPLETED", "CANCELLED"];
export const BORN_CATEGORIES = ["BARU", "SEWA"];
// Unit lahir di workshop = baru dibuat: status RECEIVED, belum punya tahap/log produksi V1. Unit yang sudah berjalan/selesai di V1
// (legacy) atau punya jalur pickup/custody TIDAK boleh dimasukkan ke V2 lewat jalur ini.
export const BORN_UNIT_STATUSES = ["RECEIVED"];

function workError(message, statusCode, code, details) {
  return Object.assign(new Error(message), { statusCode, code, ...(details ? { details } : {}) });
}
const hash = (value) => createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");

export function assertIdempotencyKey(key) {
  if (!key || !IDEMPOTENCY_KEY.test(key)) throw workError("Idempotency-Key wajib diisi (12-128 karakter)", 400, "IDEMPOTENCY_KEY_INVALID");
}
export function assertExpectedRevision(value) {
  const revision = Number(value);
  if (value == null || value === "" || !Number.isInteger(revision) || revision < 1) {
    throw workError("expectedRevision wajib diisi (angka bulat positif)", 400, "EXPECTED_REVISION_REQUIRED");
  }
  return revision;
}
// Aturan murni (diuji unit).
export function assertRunRevision(run, expectedRevision) {
  if (run.revision !== expectedRevision) {
    throw workError(`Revisi eksekusi berubah: diharapkan ${expectedRevision}, sekarang ${run.revision}. Muat ulang.`, 409, "WORKSHOP_REVISION_CONFLICT", { revision: run.revision });
  }
}
// Jalur eksekusi = jalur routing V1 dipisah oleh gerbang QC pertama: `stages` (SEBELUM gerbang -> AWAITING_QC), `qcStage` (diputuskan lewat
// command QC V2, bukan tahap yang dieksekusi di sini), dan `postQcStages` (SETELAH gerbang, mis. Jahit Corner + Finish; wajib selesai sebelum
// handoff barang jadi). `executable` = stages + postQcStages. Tanpa gerbang QC di jalur, "menuju AWAITING_QC" tidak terdefinisi.
export function workshopPathOf(path) {
  const qcIndex = path.findIndex((stage) => stage.requiresQc);
  if (qcIndex === -1) throw workError("Jalur routing unit ini tidak memiliki gerbang QC — hubungi Production Lead", 422, "WORKSHOP_NO_QC_GATE");
  if (qcIndex === 0) throw workError("Jalur routing unit ini tidak memiliki tahap workshop sebelum QC", 422, "WORKSHOP_EMPTY_PATH");
  const stages = path.slice(0, qcIndex);
  const postQcStages = path.slice(qcIndex + 1);
  return { stages, qcStage: path[qcIndex], postQcStages, executable: [...stages, ...postQcStages] };
}
export function assertAssignedOperator(plan, operator, workCenterId) {
  if (!plan.operatorId || !plan.workCenterId) throw workError("Rencana belum memiliki operator/workshop", 409, "WORKSHOP_PLAN_NOT_ASSIGNED");
  if (!operator || !operator.active || operator.id !== plan.operatorId) {
    throw workError("Anda bukan operator yang ditugaskan pada rencana ini", 403, "WORKSHOP_OPERATOR_MISMATCH");
  }
  if (!workCenterId || workCenterId !== plan.workCenterId) {
    throw workError("Workshop tidak sesuai dengan penugasan rencana", 422, "WORKSHOP_WORK_CENTER_MISMATCH");
  }
}
// Material siap = plan MATERIAL_RESERVED, issue P4 ISSUED, tidak ada reservasi ACTIVE, dan tiap baris BOM aktif punya reservasi CONSUMED.
export function materialReadiness({ plan, issuedCount, activeReservations, consumedBomLineIds }) {
  if (!plan || plan.status !== "MATERIAL_RESERVED") return { ready: false, reason: "Rencana belum berstatus Bahan Direservasi" };
  if (issuedCount < 1) return { ready: false, reason: "Bahan belum diserahkan Gudang (material issue belum ISSUED)" };
  if (activeReservations > 0) return { ready: false, reason: "Masih ada reservasi bahan yang belum dikonsumsi" };
  const missing = (plan.bomLines || []).filter((line) => !consumedBomLineIds.has(line.id));
  if (missing.length > 0) return { ready: false, reason: "Ada baris Planned BOM tanpa reservasi CONSUMED" };
  return { ready: true, reason: null };
}

async function beginCommand(tx, { actor, idempotencyKey, commandType, aggregateId, requestHash, expectedRevision = null }) {
  return tx.v2Command.create({
    data: { domain: "PRODUCTION", actorId: actor, idempotencyKey, commandType, aggregateType: "ProductionRun", aggregateId, expectedRevision, requestHash },
  });
}
async function finishCommand(tx, command, appliedRevision, response) {
  await tx.v2Command.update({ where: { id: command.id }, data: { status: "APPLIED", appliedRevision, response, completedAt: new Date() } });
}
async function outbox(tx, { eventType, aggregateId, revision, dedupeKey, payload }) {
  return tx.domainOutbox.create({ data: { domain: "PRODUCTION", eventType, aggregateType: "ProductionRun", aggregateId, aggregateRevision: revision, dedupeKey, payload } });
}
async function findReplay(tx, actor, idempotencyKey, requestHash) {
  const replay = await tx.v2Command.findUnique({ where: { actorId_idempotencyKey: { actorId: actor, idempotencyKey } } });
  if (!replay) return null;
  if (replay.requestHash !== requestHash) throw workError("Idempotency-Key dipakai untuk payload berbeda", 409, "IDEMPOTENCY_CONFLICT");
  if (replay.status !== "APPLIED") throw workError("Command masih diproses", 409, "COMMAND_IN_PROGRESS");
  return { replayed: true, ...replay.response };
}
async function assertWriterEnabledForUnit(tx, unitId) {
  const state = resolveProductionWriterState(await loadV2Flags(tx));
  if (!isProductionWriterEnabledFor(state, unitId)) {
    throw workError("Eksekusi workshop V2 tidak aktif untuk unit ini; gunakan alur lama", 503, "WORKSHOP_WRITER_OFF");
  }
}
// Kesalahan transisi engine V1 (StageTransitionError) dipetakan ke galat berkode dengan status ASLI engine (400 validasi / 409 konflik); kesalahan lain dilempar apa adanya.
async function viaEngine(fn) {
  try { return await fn(); } catch (error) {
    if (error?.name !== "Error" || typeof error.statusCode !== "number" || error.code) throw error;
    throw workError(error.message, error.statusCode, "WORKSHOP_STAGE_TRANSITION_INVALID");
  }
}

export const RUN_INCLUDE = {
  unit: { select: { id: true, unitCode: true, orderId: true, serviceId: true, status: true, currentStageId: true, order: { select: { category: true, orderNumber: true } } } },
  plan: { include: { bomLines: { where: { status: "ACTIVE" } }, workCenter: { select: { id: true, code: true, name: true } }, operator: { select: { id: true, userId: true, active: true, user: { select: { name: true } } } } } },
  phases: true,
  operations: { orderBy: { sequence: "asc" } },
};

// Urutan kunci: unit (sama dengan custody) -> run. Mencegah siklus dengan openProductionIntakeV2 (unit lalu run).
export async function loadRunForWrite(tx, runId) {
  const pre = await tx.productionRun.findUnique({ where: { id: runId }, select: { unitId: true } });
  if (!pre) throw workError("Production Run tidak ditemukan", 404, "WORKSHOP_RUN_NOT_FOUND");
  await lockRowForUpdate(tx, "units", pre.unitId);
  await lockRowForUpdate(tx, "production_runs_v2", runId);
  const run = await tx.productionRun.findUnique({ where: { id: runId }, include: RUN_INCLUDE });
  if (TERMINAL_RUN.includes(run.status)) throw workError("Production Run sudah selesai/dibatalkan", 409, "WORKSHOP_RUN_TERMINAL");
  await assertNoV1Drift(tx, { runId, unitId: run.unitId }); // rollback writer OFF -> aksi V1 -> writer ON: berhenti sampai direkonsiliasi (productionRunGuards.js)
  // P9A (One-Location Production Intake) — unit sudah "Masuk Produksi" (pickup
  // berhasil, kartu tampil di board) TAPI belum dikonfirmasi tiba secara fisik
  // di workshop. SATU-SATUNYA titik gerbang untuk SELURUH command tahap
  // (start/pause/resume/complete P5, dipakai ulang P8 productionStepCommandService.js
  // — lihat catatan header file ini) supaya tidak ada jalur yang lolos memulai
  // tahap sebelum "Unit Tiba di Workshop" diklik.
  if (run.status === "PENDING_ARRIVAL") {
    throw workError("Unit belum dikonfirmasi tiba di workshop — konfirmasi kedatangan dulu sebelum memulai tahap produksi", 409, "WORKSHOP_RUN_PENDING_ARRIVAL");
  }
  return run;
}

// Bukti serah bahan: tiap baris BOM harus punya reservasi CONSUMED milik plan ini YANG DIRUJUK baris material issue ISSUED milik plan
// yang SAMA dengan issuedQty >= qty reservasi. Reservasi CONSUMED tanpa baris issue ISSUED, atau issue terminal milik plan lain,
// tidak dihitung.
export async function loadMaterialFacts(tx, plan) {
  const [issuedCount, activeReservations, consumed, issuedLines] = await Promise.all([
    tx.materialIssue.count({ where: { productionPlanId: plan.id, status: "ISSUED" } }),
    tx.materialReservation.count({ where: { planId: plan.id, status: "ACTIVE" } }),
    tx.materialReservation.findMany({ where: { planId: plan.id, status: "CONSUMED" }, select: { id: true, bomLineId: true, qty: true } }),
    tx.materialIssueLine.findMany({ where: { reservationId: { not: null }, materialIssue: { productionPlanId: plan.id, status: "ISSUED" } }, select: { reservationId: true, issuedQty: true } }),
  ]);
  const issuedByReservation = new Map(issuedLines.map((line) => [line.reservationId, Number(line.issuedQty ?? 0)]));
  const covered = consumed.filter((r) => (issuedByReservation.get(r.id) ?? -1) >= Number(r.qty) - 1e-9);
  return { issuedCount, activeReservations, consumedBomLineIds: new Set(covered.map((r) => r.bomLineId)) };
}

// PIC Corner (P8): tahap pasca-QC dikerjakan operator Corner bila rencana menugaskannya; work center Corner default ke work center rencana.
export function assertAssignedCornerOperator(plan, operator, workCenterId) {
  if (!plan.cornerOperatorId) return assertAssignedOperator(plan, operator, workCenterId);
  if (!operator || !operator.active || operator.id !== plan.cornerOperatorId) {
    throw workError("Anda bukan PIC Corner yang ditugaskan pada rencana ini", 403, "WORKSHOP_OPERATOR_MISMATCH");
  }
  const expected = plan.cornerWorkCenterId || plan.workCenterId;
  if (!workCenterId || workCenterId !== expected) throw workError("Workshop Corner tidak sesuai dengan penugasan rencana", 422, "WORKSHOP_WORK_CENTER_MISMATCH");
}

// Keputusan owner 4 Oktober 2026: ADMIN/OWNER (izin PRODUCTION_EXECUTE_ANY) boleh mengerjakan tahap pada unit PIC mana pun.
// Pagar yang TETAP berlaku: rencana wajib sudah ditugaskan (operator+workshop) dan workshop harus sesuai penugasan.
// Yang dilewati HANYA "anda harus PIC yang ditugaskan". Aksi tetap tercatat atas actor_id user penekan (bukan PIC) — jejak audit jujur.
export const mayExecuteAnyUnit = (user) => hasPermission(user, P.PRODUCTION_EXECUTE_ANY);
export function assertOverridePlanAndWorkCenter(plan, workCenterId, { postQc = false } = {}) {
  if (!plan.operatorId || !plan.workCenterId) throw workError("Rencana belum memiliki operator/workshop", 409, "WORKSHOP_PLAN_NOT_ASSIGNED");
  const expected = postQc ? (plan.cornerWorkCenterId || plan.workCenterId) : plan.workCenterId;
  if (!workCenterId || workCenterId !== expected) throw workError("Workshop tidak sesuai dengan penugasan rencana", 422, "WORKSHOP_WORK_CENTER_MISMATCH");
}

export async function authorizeOperator(tx, run, actorId, workCenterId, { postQc = false } = {}) {
  const plan = run.plan;
  if (!plan || plan.status === "CANCELLED") throw workError("Production Run belum memiliki rencana aktif", 409, "WORKSHOP_NO_PLAN");
  const actor = actorId ? await tx.user.findUnique({ where: { id: actorId }, select: { role: true, active: true, roles: { select: { role: true } } } }) : null;
  if (actor?.active && mayExecuteAnyUnit({ role: actor.role, roles: [actor.role, ...(actor.roles || []).map((r) => r.role)] })) {
    assertOverridePlanAndWorkCenter(plan, workCenterId, { postQc });
    return plan;
  }
  const operator = actorId ? await tx.productionOperator.findUnique({ where: { userId: actorId } }) : null;
  if (postQc) assertAssignedCornerOperator(plan, operator, workCenterId);
  else assertAssignedOperator(plan, operator, workCenterId);
  return plan;
}

// Tahap INTAKE routing boleh berjalan tanpa material, tetapi rencana wajib sudah ditugaskan (bukan DRAFT/CANCELLED).
function assertPlanReadyForIntake(plan) {
  if (!plan || !["PLANNED", "MATERIAL_RESERVED"].includes(plan.status)) {
    throw workError("Rencana produksi belum ditugaskan (operator/workshop); tahap bongkar belum bisa dimulai", 409, "WORKSHOP_PLAN_NOT_ASSIGNED");
  }
}

async function assertMaterialIssued(tx, plan) {
  const readiness = materialReadiness({ plan, ...(await loadMaterialFacts(tx, plan)) });
  if (!readiness.ready) throw workError(`Produksi belum bisa dimulai: ${readiness.reason}`, 409, "WORKSHOP_MATERIAL_NOT_ISSUED", { reason: readiness.reason });
}

// Override manual V1 (status order/unit) dapat memindahkan unit ke CANCELLED/READY_FOR_DELIVERY/DELIVERED di luar V2; eksekusi
// workshop berhenti (409) alih-alih menulis ledger tahap untuk unit yang sudah bukan pekerjaan workshop.
const EXECUTING_UNIT_STATUSES = ["RECEIVED", "IN_PRODUCTION"];
function assertUnitInProduction(run, allowed = EXECUTING_UNIT_STATUSES) {
  if (!allowed.includes(run.unit.status)) {
    throw workError(`Unit berstatus ${run.unit.status}; eksekusi workshop tidak dapat dilanjutkan — hubungi Production Lead`, 409, "WORKSHOP_UNIT_NOT_IN_PRODUCTION", { unitStatus: run.unit.status });
  }
}
function phaseOf(run, phase) { return run.phases.find((p) => p.phase === phase); }
function assertProcessApplicable(run) {
  const process = phaseOf(run, "PROCESS");
  if (!process || process.status === "NOT_APPLICABLE") throw workError("Run ini tidak memiliki proses workshop", 409, "WORKSHOP_PROCESS_NOT_APPLICABLE");
  if (process.status === "COMPLETED") {
    if (run.currentPhase === "HANDOFF") throw workError("Seluruh tahap produksi selesai; barang jadi menunggu keputusan Gudang", 409, "WORKSHOP_IN_HANDOFF");
    throw workError("Proses workshop sudah selesai; unit menunggu QC", 409, "WORKSHOP_AWAITING_QC");
  }
  if (phaseOf(run, "HANDOFF")?.status === "BLOCKED") throw workError("Handoff barang jadi ditolak Gudang; tindak lanjut lewat antrean QC/Produksi", 409, "WORKSHOP_HANDOFF_REJECTED");
  return process;
}
// Awal proses workshop = INTAKE selesai (barang sudah diterima Gudang + plan + bahan diserahkan) dan DIAGNOSIS tidak berlaku (belum ada command diagnosis V2).
// Run baru: fase sebelum PROCESS wajib sudah tertutup atau ditutup di transisi yang sama; kondisi lain (mis. DIAGNOSIS sedang berjalan) = 409, bukan ditutup diam-diam.
// Run legacy/backfill: perilaku lama (hanya PROCESS -> ACTIVE).
function processStartTransition(run, now) {
  const updates = [];
  if (isStrictLifecycleRun(run)) {
    const intake = phaseOf(run, "INTAKE");
    const diagnosis = phaseOf(run, "DIAGNOSIS");
    if (intake?.status === "ACTIVE") updates.push({ phase: "INTAKE", data: { status: "COMPLETED", completedAt: now } });
    else if (!PHASE_TERMINAL_STATUSES.includes(intake?.status)) throw workError(`Fase Intake belum siap ditutup (status ${intake?.status ?? "tidak ada"}); proses workshop tidak dapat dimulai`, 409, "WORKSHOP_INTAKE_NOT_CLOSABLE", { phase: "INTAKE", status: intake?.status ?? null });
    if (diagnosis?.status === "NOT_STARTED") updates.push({ phase: "DIAGNOSIS", data: { status: "NOT_APPLICABLE", reason: "Diagnosis V2 belum tersedia; kebutuhan pekerjaan ditetapkan lewat layanan unit dan Planning V2" } });
    else if (!PHASE_TERMINAL_STATUSES.includes(diagnosis?.status)) throw workError(`Fase Diagnosis masih ${diagnosis?.status ?? "tidak ada"}; selesaikan dulu sebelum proses workshop dimulai`, 409, "WORKSHOP_DIAGNOSIS_OPEN", { phase: "DIAGNOSIS", status: diagnosis?.status ?? null });
  }
  updates.push({ phase: "PROCESS", data: { status: "ACTIVE", startedAt: now } });
  return updates;
}
export const isAdaptationRun = (run) => run?.adaptationPolicy === ADAPTATION_POLICY;
export function activeOperation(run) { return run.operations.find((op) => op.status === "ACTIVE" || op.status === "PAUSED") || null; }

// Naikkan revisi run (dipakai juga command bukti P8 untuk langkah tanpa transisi tahap) — penulis production_runs_v2 tetap file ini.
export async function bumpRunRevisionInTx(tx, run, data = {}) {
  return bumpRun(tx, run, data);
}

async function bumpRun(tx, run, data) {
  const revision = run.revision + 1;
  await tx.productionRun.update({ where: { id: run.id }, data: { ...data, revision } });
  return revision;
}

// ---------------------------------------------------------------------------
// 0. Unit BARU/SEWA yang lahir di workshop TANPA pickup -> Production Run WORKSHOP_BORN (kanonis; bukan migrationSource).
//    Tidak membuat custody apa pun: custody barang jadi baru lahir setelah QC/P6.
// ---------------------------------------------------------------------------
export async function registerWorkshopBornRun(prisma, args) {
  return prisma.$transaction((tx) => registerWorkshopBornRunInTx(tx, args));
}

// Varian di dalam transaksi pemanggil (Rencana Produksi: buka Run + rencana + jadwal = SATU commit). Isi command TIDAK berubah.
export async function registerWorkshopBornRunInTx(tx, { unitId, actorId, idempotencyKey }) {
  if (!unitId) throw workError("unitId wajib diisi", 400, "WORKSHOP_UNIT_REQUIRED");
  assertIdempotencyKey(idempotencyKey);
  const actor = actorId || "SYSTEM";
  const requestHash = hash({ commandType: "REGISTER_WORKSHOP_RUN", unitId });

  return (async () => {
    await lockRowForUpdate(tx, "units", unitId);
    await lockUnitOwnership(tx, unitId); // pembukaan Run = pengambilalihan kepemilikan (lihat unitV2Ownership.js)
    const replay = await findReplay(tx, actor, idempotencyKey, requestHash);
    if (replay) return replay;
    const unit = await tx.unit.findUnique({ where: { id: unitId }, select: { id: true, unitCode: true, status: true, currentStageId: true, order: { select: { category: true } } } });
    if (!unit) throw workError("Unit tidak ditemukan", 404, "WORKSHOP_UNIT_NOT_FOUND");
    await assertWriterEnabledForUnit(tx, unitId);
    if (!BORN_CATEGORIES.includes(unit.order?.category)) throw workError("Hanya unit BARU/SEWA yang boleh didaftarkan lahir di workshop", 422, "WORKSHOP_BORN_CATEGORY_INVALID");
    if (!BORN_UNIT_STATUSES.includes(unit.status)) throw workError(`Unit berstatus ${unit.status}; tidak dapat didaftarkan ke workshop`, 409, "WORKSHOP_BORN_STATUS_INVALID");
    const active = await tx.productionRun.findFirst({ where: { unitId, status: { notIn: TERMINAL_RUN } }, select: { id: true } });
    if (active) throw workError("Unit ini sudah memiliki Production Run aktif", 409, "WORKSHOP_RUN_ALREADY_EXISTS", { runId: active.id });
    const stageLogs = await tx.unitStageLog.count({ where: { unitId } });
    if (unit.currentStageId || stageLogs > 0) {
      throw workError("Unit ini sudah punya riwayat produksi V1/legacy; tidak dapat didaftarkan sebagai unit lahir di workshop", 409, "WORKSHOP_BORN_UNIT_NOT_FRESH");
    }
    const pickup = await tx.jobUnit.findFirst({ where: { unitId, job: { type: "PICKUP" } }, select: { id: true } });
    const inbound = await tx.unitCustodyHandoff.findFirst({ where: { unitId, direction: "INBOUND" }, select: { id: true } });
    if (pickup || inbound) throw workError("Unit ini punya jalur pickup/custody; gunakan alur custody, bukan lahir di workshop", 409, "WORKSHOP_BORN_HAS_PICKUP");

    const now = new Date();
    const command = await beginCommand(tx, { actor, idempotencyKey, commandType: "REGISTER_WORKSHOP_RUN", aggregateId: unitId, requestHash });
    const na = "Unit lahir di workshop (tanpa pickup)";
    const phases = [["INTAKE", "NOT_APPLICABLE", na], ["DIAGNOSIS", "NOT_APPLICABLE", na], ["PROCESS", "NOT_STARTED", null], ["QC", "NOT_STARTED", null], ["HANDOFF", "NOT_STARTED", null]];
    const run = await tx.productionRun.create({
      data: {
        unitId, kind: "NEW_PRODUCT", origin: "WORKSHOP_BORN", status: "ACTIVE", currentPhase: "PROCESS", revision: 1, adaptationPolicy: await defaultAdaptationPolicy(tx),
        phases: { create: phases.map(([phase, status, reason], index) => ({ phase, status, reason, sequence: index + 1 })) },
      },
    });
    await outbox(tx, {
      eventType: "production.run.opened", aggregateId: run.id, revision: 1, dedupeKey: `production-run-opened:${run.id}:1`,
      payload: { runId: run.id, unitId, kind: run.kind, origin: "WORKSHOP_BORN", revision: 1, occurredAt: now.toISOString(), actorId },
    });
    await recordActivity(tx, {
      entityType: "unit", entityId: unitId, eventType: EVENT_TYPES.PRODUCTION_WORKSHOP_RUN_REGISTERED, actorId: actorId || null,
      metadata: { unitCode: unit.unitCode, runId: run.id, category: unit.order.category },
    });
    const response = { runId: run.id, unitId, origin: "WORKSHOP_BORN", status: "ACTIVE", revision: 1 };
    await finishCommand(tx, command, 1, response);
    return { replayed: false, ...response };
  })();
}

// ---------------------------------------------------------------------------
// 1. MULAI tahap berikutnya di jalur workshop.
// ---------------------------------------------------------------------------
export async function startWorkshopStage(prisma, { runId, actorId, idempotencyKey, expectedRevision, workCenterId }) {
  if (!runId) throw workError("runId wajib diisi", 400, "WORKSHOP_RUN_ID_REQUIRED");
  assertIdempotencyKey(idempotencyKey);
  const revisionExpected = assertExpectedRevision(expectedRevision);
  const actor = actorId || "SYSTEM";
  const requestHash = hash({ commandType: "START_WORKSHOP_STAGE", runId, expectedRevision: revisionExpected, workCenterId: workCenterId || null });

  return prisma.$transaction(async (tx) => {
    const run = await loadRunForWrite(tx, runId);
    const replay = await findReplay(tx, actor, idempotencyKey, requestHash);
    if (replay) return replay;
    await assertWriterEnabledForUnit(tx, run.unitId);
    // Otorisasi (operator/work center) SEBELUM revisi: pihak yang tidak berhak tidak perlu tahu revisi. Tahap target diintip lebih dulu
    // (tanpa melempar) hanya untuk memilih PIC meja vs PIC Corner.
    await authorizeOperator(tx, run, actorId, workCenterId, { postQc: await peekStartIsPostQc(tx, run) });
    assertRunRevision(run, revisionExpected);
    const prepared = await prepareStartInTx(tx, run);
    const command = await beginCommand(tx, { actor, idempotencyKey, commandType: "START_WORKSHOP_STAGE", aggregateId: runId, requestHash, expectedRevision: revisionExpected });
    const response = await applyStartInTx(tx, { run, prepared, actorId });
    await finishCommand(tx, command, response.revision, response);
    return { replayed: false, ...response };
  });
}

// Tahap berikutnya pasca-QC? (tanpa melempar; dipakai memilih pihak yang berwenang sebelum validasi penuh)
export async function peekStartIsPostQc(tx, run) {
  try {
    const path = await pathForUnit(tx, run.unit);
    const { postQcStages } = workshopPathOf(path);
    const { stage } = await resolveCurrentTarget(tx, run.unit, path);
    return !!stage && postQcStages.some((s) => s.id === stage.id);
  } catch { return false; }
}
export async function isPostQcStage(tx, run, stageId) {
  try {
    return workshopPathOf(await pathForUnit(tx, run.unit)).postQcStages.some((s) => s.id === stageId);
  } catch { return false; }
}

// Validasi mulai tahap SETELAH otorisasi & revisi. Gerbang material hanya untuk tahap non-INTAKE (P8: bongkar/uji/diagnosa mendahului BOM).
export async function prepareStartInTx(tx, run) {
  await assertNoOpenRunException(tx, run.id);
  assertUnitInProduction(run);
  const process = assertProcessApplicable(run);
  if (activeOperation(run)) throw workError("Masih ada tahap aktif pada run ini; selesaikan atau lanjutkan tahap tersebut", 409, "WORKSHOP_STAGE_ALREADY_ACTIVE");
  const path = await pathForUnit(tx, run.unit);
  const { executable, postQcStages } = workshopPathOf(path);
  const { stage } = await resolveCurrentTarget(tx, run.unit, path);
  if (stage?.requiresQc) throw workError("Seluruh tahap workshop sudah selesai; unit menunggu QC", 409, "WORKSHOP_AWAITING_QC");
  // targetState DONE dengan fase PROCESS masih ACTIVE = tahap terakhir dijalankan ULANG (rework setelah penolakan Gudang); yang benar-benar selesai
  // sudah ditolak assertProcessApplicable (PROCESS COMPLETED -> AWAITING_QC/IN_HANDOFF).
  if (!stage || !executable.some((s) => s.id === stage.id)) throw workError("Tahap unit sekarang tidak ada di jalur workshop — perlu penanganan Production Lead", 409, "WORKSHOP_STAGE_MISMATCH");
  if (stage.phase === "INTAKE") assertPlanReadyForIntake(run.plan);
  else await assertMaterialIssued(tx, run.plan);
  return { process, stage, isPostQc: postQcStages.some((s) => s.id === stage.id) };
}

// Terapkan mulai tahap (engine V1 *InTx + operasi V2 + fase + revisi + outbox). Pemanggil sudah mengunci unit->run dan memvalidasi.
export async function applyStartInTx(tx, { run, prepared, actorId, now = new Date() }) {
  const { process, stage, isPostQc } = prepared;
  const runId = run.id;
  await viaEngine(() => startStageInTx(tx, run.unitId, { actorId, allowRerunOfLastStage: true }));
  const sequence = (run.operations.at(-1)?.sequence ?? 0) + 1;
  const operatorId = isPostQc && run.plan.cornerOperatorId ? run.plan.cornerOperatorId : run.plan.operatorId;
  const workCenterId = isPostQc && run.plan.cornerOperatorId ? (run.plan.cornerWorkCenterId || run.plan.workCenterId) : run.plan.workCenterId;
  const operation = await tx.productionOperationRun.create({
    data: {
      runId, stageId: stage.id, stageCode: stage.code, stageLabel: stage.labelId, sequence, required: !stage.isOptional, status: "ACTIVE", startedAt: now,
      planSnapshot: { workCenterId, operatorId, serviceId: run.unit.serviceId, planId: run.plan.id },
    },
  });
  if (process.status === "NOT_STARTED") await transitionPhases(tx, runId, processStartTransition(run, now));
  const revision = await bumpRun(tx, run, { currentPhase: "PROCESS", startedAt: run.startedAt || now });
  await outbox(tx, {
    eventType: "production.stage.started", aggregateId: runId, revision, dedupeKey: `production-stage-started:${runId}:${revision}`,
    payload: { runId, unitId: run.unitId, stageId: stage.id, stageCode: stage.code, sequence, operatorId, workCenterId, revision, occurredAt: now.toISOString(), actorId },
  });
  return { runId, revision, stage: { id: stage.id, code: stage.code, label: stage.labelId }, status: "ACTIVE", sequence, operationRunId: operation.id };
}

async function operationCommand(prisma, { commandType, runId, actorId, idempotencyKey, expectedRevision, workCenterId, payload, expectStatus, apply }) {
  if (!runId) throw workError("runId wajib diisi", 400, "WORKSHOP_RUN_ID_REQUIRED");
  assertIdempotencyKey(idempotencyKey);
  const revisionExpected = assertExpectedRevision(expectedRevision);
  const actor = actorId || "SYSTEM";
  const requestHash = hash({ commandType, runId, expectedRevision: revisionExpected, workCenterId: workCenterId || null, ...payload });

  return prisma.$transaction(async (tx) => {
    const run = await loadRunForWrite(tx, runId);
    const replay = await findReplay(tx, actor, idempotencyKey, requestHash);
    if (replay) return replay;
    await assertWriterEnabledForUnit(tx, run.unitId);
    const current = activeOperation(run);
    await authorizeOperator(tx, run, actorId, workCenterId, { postQc: current ? await isPostQcStage(tx, run, current.stageId) : false });
    assertRunRevision(run, revisionExpected);
    await assertNoOpenRunException(tx, runId);
    assertUnitInProduction(run, ["IN_PRODUCTION"]);
    const op = current;
    if (!op) throw workError("Tidak ada tahap yang sedang berjalan/dijeda pada run ini", 409, "WORKSHOP_NO_ACTIVE_STAGE");
    if (op.status !== expectStatus) {
      throw workError(expectStatus === "ACTIVE" ? "Tahap sedang dijeda — gunakan Lanjutkan" : "Tahap tidak sedang berjalan — gunakan Mulai/Lanjutkan", 409, "WORKSHOP_STAGE_STATE_INVALID", { status: op.status });
    }
    const command = await beginCommand(tx, { actor, idempotencyKey, commandType, aggregateId: runId, requestHash, expectedRevision: revisionExpected });
    const response = await apply(tx, { run, op, actor, command });
    await finishCommand(tx, command, response.revision, response);
    return { replayed: false, ...response };
  });
}

// ---------------------------------------------------------------------------
// 2. JEDA (alasan wajib; foto/catatan opsional sebagai evidence).
// ---------------------------------------------------------------------------
export async function pauseWorkshopStage(prisma, { runId, actorId, idempotencyKey, expectedRevision, workCenterId, reason, note, photoUrls = [] }) {
  const invalid = validatePauseReason({ reason, note });
  if (invalid) throw workError(invalid, 400, "WORKSHOP_PAUSE_REASON_INVALID");
  return operationCommand(prisma, {
    commandType: "PAUSE_WORKSHOP_STAGE", runId, actorId, idempotencyKey, expectedRevision, workCenterId, expectStatus: "ACTIVE",
    payload: { reason: reason || null, note: note || null, photoUrls },
    apply: (tx, { run, op }) => applyPauseInTx(tx, { run, op, actorId, reason, note, photoUrls }),
  });
}

export async function applyPauseInTx(tx, { run, op, actorId, reason, note = null, photoUrls = [] }) {
  await viaEngine(() => pauseStageInTx(tx, run.unitId, op.stageId, { actorId, reason, note, photoUrls }));
  await tx.productionOperationRun.update({ where: { id: op.id }, data: { status: "PAUSED" } });
  const revision = await bumpRun(tx, run, {});
  await outbox(tx, {
    eventType: "production.stage.paused", aggregateId: run.id, revision, dedupeKey: `production-stage-paused:${run.id}:${revision}`,
    payload: { runId: run.id, unitId: run.unitId, stageId: op.stageId, reason, revision, occurredAt: new Date().toISOString(), actorId },
  });
  return { runId: run.id, revision, stage: { id: op.stageId, code: op.stageCode, label: op.stageLabel }, status: "PAUSED", reason };
}

// ---------------------------------------------------------------------------
// 3. LANJUTKAN tahap yang dijeda.
// ---------------------------------------------------------------------------
export async function resumeWorkshopStage(prisma, { runId, actorId, idempotencyKey, expectedRevision, workCenterId }) {
  return operationCommand(prisma, {
    commandType: "RESUME_WORKSHOP_STAGE", runId, actorId, idempotencyKey, expectedRevision, workCenterId, expectStatus: "PAUSED", payload: {},
    apply: (tx, { run, op }) => applyResumeInTx(tx, { run, op, actorId }),
  });
}

export async function applyResumeInTx(tx, { run, op, actorId }) {
  await viaEngine(() => resumeStageInTx(tx, run.unitId, op.stageId, { actorId }));
  await tx.productionOperationRun.update({ where: { id: op.id }, data: { status: "ACTIVE", delayKind: null, delayNote: null } });
  const revision = await bumpRun(tx, run, {});
  await outbox(tx, {
    eventType: "production.stage.resumed", aggregateId: run.id, revision, dedupeKey: `production-stage-resumed:${run.id}:${revision}`,
    payload: { runId: run.id, unitId: run.unitId, stageId: op.stageId, revision, occurredAt: new Date().toISOString(), actorId },
  });
  return { runId: run.id, revision, stage: { id: op.stageId, code: op.stageCode, label: op.stageLabel }, status: "ACTIVE" };
}

// ---------------------------------------------------------------------------
// 4. SELESAI tahap. Tahap workshop terakhir -> AWAITING_QC (tidak pernah READY_FOR_DELIVERY/PASS QC).
// ---------------------------------------------------------------------------
export async function completeWorkshopStage(prisma, { runId, actorId, idempotencyKey, expectedRevision, workCenterId, note, photoUrls = [] }) {
  return operationCommand(prisma, {
    commandType: "COMPLETE_WORKSHOP_STAGE", runId, actorId, idempotencyKey, expectedRevision, workCenterId, expectStatus: "ACTIVE",
    payload: { note: note || null, photoUrls },
    apply: (tx, { run, op }) => applyCompleteInTx(tx, { run, op, actorId, note, photoUrls }),
  });
}

// Terapkan selesai tahap (engine V1 *InTx deferReady + operasi + fase + revisi + [handoff barang jadi P6] + outbox). Pemanggil sudah mengunci & memvalidasi.
export async function applyCompleteInTx(tx, { run, op, actorId, note = null, photoUrls = [] }) {
  const now = new Date();
  // deferReady: tahap TERAKHIR jalur selesai TIDAK menjadikan unit READY_FOR_DELIVERY — itu baru terjadi setelah Gudang menerima barang jadi.
  await viaEngine(() => completeStageInTx(tx, run.unitId, op.stageId, { actorId, photoUrls, note, deferReady: true }));
  await tx.productionOperationRun.update({ where: { id: op.id }, data: { status: "COMPLETED", completedAt: now } });
  const unit = await tx.unit.findUniqueOrThrow({ where: { id: run.unitId }, select: { currentStageId: true, status: true } });
  const path = await pathForUnit(tx, run.unit);
  const adaptation = isAdaptationRun(run);
  const handoffReady = isLastStage(path, op.stageId);
  const next = !handoffReady && unit.currentStageId ? path.find((s) => s.id === unit.currentStageId) : null;
  // Mode adaptasi (slice 2): QC tidak wajib — tahap kerja terakhir TIDAK memindahkan run ke fase QC; run tetap di PROCESS menunggu "Selesaikan Produksi".
  const awaitingQc = !!next?.requiresQc && !isAdaptationRun(run);
  // Penutupan PROCESS dan pembukaan HANDOFF dalam SATU transisi atomik (hanya satu fase berjalan).
  const phaseUpdates = [];
  if (awaitingQc || (handoffReady && !adaptation)) phaseUpdates.push({ phase: "PROCESS", data: { status: "COMPLETED", completedAt: now } });
  if (handoffReady && !adaptation) phaseUpdates.push({ phase: "HANDOFF", data: { status: "ACTIVE", startedAt: now, reason: null } });
  if (phaseUpdates.length) await transitionPhases(tx, run.id, phaseUpdates);
  const revision = await bumpRun(tx, run, awaitingQc ? { currentPhase: "QC" } : (handoffReady && !adaptation) ? { currentPhase: "HANDOFF" } : {});
  // Handoff barang jadi HANYA setelah tahap `finished` (terakhir) selesai; QC wajib sudah lulus/di-waive (divalidasi offerFinishedGoodsCustodyInTx,
  // kesalahan apa pun me-rollback seluruh penyelesaian tahap ini).
  // Mode adaptasi: TIDAK ada penawaran barang jadi/custody (penerimaan Gudang tidak diwajibkan); penutupan lewat "Selesaikan Produksi".
  const handoff = handoffReady && !adaptation ? await offerFinishedGoodsCustodyInTx(tx, { runId: run.id, actorId }) : null;
  await outbox(tx, {
    eventType: "production.stage.completed", aggregateId: run.id, revision, dedupeKey: `production-stage-completed:${run.id}:${revision}`,
    payload: { runId: run.id, unitId: run.unitId, stageId: op.stageId, awaitingQc, handoffReady, revision, occurredAt: now.toISOString(), actorId },
  });
  if (awaitingQc) {
    await outbox(tx, {
      eventType: "production.run.awaiting_qc", aggregateId: run.id, revision, dedupeKey: `production-run-awaiting-qc:${run.id}:${revision}`,
      payload: { runId: run.id, unitId: run.unitId, qcStageId: next.id, revision, occurredAt: now.toISOString(), actorId },
    });
    await recordActivity(tx, {
      entityType: "unit", entityId: run.unitId, eventType: EVENT_TYPES.PRODUCTION_WORKSHOP_AWAITING_QC, actorId: actorId || null,
      metadata: { unitCode: run.unit.unitCode, runId: run.id },
    });
  }
  return { runId: run.id, revision, stage: { id: op.stageId, code: op.stageCode, label: op.stageLabel }, status: "COMPLETED", awaitingQc, handoffReady, ...(handoff ? { handoffId: handoff.handoff.id } : {}), unitStatus: unit.status };
}

// ---------------------------------------------------------------------------
// 5. FLOW ADAPTASI (slice 2). Helper dipakai command bukti tahap (productionStepCommandService.js) di TRANSAKSI YANG SAMA dengan bukti SKIPPED;
//    penulis production_operation_runs_v2 / fase / run tetap file ini. Semua hanya berlaku untuk run berkebijakan ADAPTATION_V1.
// ---------------------------------------------------------------------------
export function assertAdaptationRun(run) {
  if (!isAdaptationRun(run)) throw workError("Mode adaptasi tidak aktif untuk Production Run ini", 409, "ADAPTATION_NOT_ENABLED");
}

// Kebijakan adaptasi pada run yang BELUM terminal (aksi eksplisit Admin/Lead; run lama tidak pernah diubah otomatis). Tidak menyentuh tahap/fase/stok.
export async function applyAdaptationPolicyInTx(tx, { run }) {
  if (isAdaptationRun(run)) return { runId: run.id, revision: run.revision, changed: false };
  const revision = await bumpRun(tx, run, { adaptationPolicy: ADAPTATION_POLICY });
  return { runId: run.id, revision, changed: true };
}

// Validasi melewati SATU tahap target (tanpa gerbang bahan: melewati tahap tidak memakai bahan). Tahap harus pra-QC, bukan gerbang QC, belum berjalan.
export async function prepareSkipInTx(tx, run) {
  assertAdaptationRun(run);
  await assertNoOpenRunException(tx, run.id);
  assertUnitInProduction(run);
  const process = assertProcessApplicable(run);
  if (activeOperation(run)) throw workError("Masih ada tahap berjalan/ditunda pada run ini; selesaikan atau lanjutkan tahap tersebut dulu", 409, "WORKSHOP_STAGE_ALREADY_ACTIVE");
  const path = await pathForUnit(tx, run.unit);
  const { stage, state } = await resolveCurrentTarget(tx, run.unit, path);
  if (!stage || !["FIRST", "READY"].includes(state)) throw workError("Tidak ada tahap yang dapat dilewati pada keadaan ini", 409, "WORKSHOP_SKIP_NOT_AVAILABLE", { state });
  if (stage.requiresQc) {
    throw workError('Gerbang QC tidak dilewati sendiri: dicatat "tidak dilakukan" saat Kirim ke Corner (tahap 9) atau lewat Selesaikan Produksi', 409, "WORKSHOP_SKIP_USE_FINISH", { stageCode: stage.code });
  }
  if (stage.phase === "INTAKE") assertPlanReadyForIntake(run.plan);
  return { process, stage };
}

async function recordSkippedOperation(tx, { run, stage, now, qcNotPerformed }) {
  const sequence = (run.operations.at(-1)?.sequence ?? 0) + 1;
  const operation = await tx.productionOperationRun.create({
    data: {
      runId: run.id, stageId: stage.id, stageCode: stage.code, stageLabel: stage.labelId, sequence, required: !stage.isOptional, status: "SKIPPED", completedAt: now,
      planSnapshot: { workCenterId: run.plan?.workCenterId ?? null, operatorId: run.plan?.operatorId ?? null, serviceId: run.unit.serviceId, planId: run.plan?.id ?? null, skipped: true, qcNotPerformed: !!qcNotPerformed },
    },
  });
  return { operation, sequence };
}

// Lewati satu tahap target: ledger tahap SKIP (engine) + operasi SKIPPED + fase PROCESS dibuka bila perlu + revisi + outbox.
export async function applySkipStageInTx(tx, { run, prepared, actorId, note = null, now = new Date() }) {
  const { process, stage } = prepared;
  await viaEngine(() => skipStageForAdaptationInTx(tx, run.unitId, stage.id, { actorId, note, deferReady: true, qcNotPerformed: false }));
  const { operation, sequence } = await recordSkippedOperation(tx, { run, stage, now, qcNotPerformed: false });
  if (process.status === "NOT_STARTED") await transitionPhases(tx, run.id, processStartTransition(run, now));
  const revision = await bumpRun(tx, run, { currentPhase: "PROCESS", startedAt: run.startedAt || now });
  await outbox(tx, {
    eventType: "production.stage.skipped", aggregateId: run.id, revision, dedupeKey: `production-stage-skipped:${run.id}:${revision}`,
    payload: { runId: run.id, unitId: run.unitId, stageId: stage.id, stageCode: stage.code, sequence, policy: ADAPTATION_POLICY, revision, occurredAt: now.toISOString(), actorId },
  });
  return { runId: run.id, revision, stage: { id: stage.id, code: stage.code, label: stage.labelId, phase: stage.phase, sequence: stage.sequence }, status: "SKIPPED", operationRunId: operation.id };
}

// Syarat "Selesaikan Produksi" (murni dari keadaan terbaca; tanpa efek). Mengembalikan daftar penghalang berkode untuk UI/command.
export function finishBlockersOf(run, { openShortage = false, exceptionOpen = false } = {}) {
  const out = [];
  if (!isAdaptationRun(run)) out.push({ code: "ADAPTATION_NOT_ENABLED", text: "Mode adaptasi belum aktif untuk run ini" });
  if (run.status === "PENDING_ARRIVAL") out.push({ code: "PENDING_ARRIVAL", text: "Unit belum dikonfirmasi tiba di workshop" });
  else if (TERMINAL_RUN.includes(run.status)) out.push({ code: "RUN_TERMINAL", text: "Production Run sudah selesai/dibatalkan" });
  if (!run.plan || run.plan.status === "CANCELLED") out.push({ code: "NO_PLAN", text: "Rencana produksi belum ditugaskan (operator/workshop)" });
  if (!["RECEIVED", "IN_PRODUCTION"].includes(run.unit?.status)) out.push({ code: "UNIT_NOT_IN_PRODUCTION", text: `Unit berstatus ${run.unit?.status}; bukan pekerjaan workshop` });
  if (activeOperation(run)) out.push({ code: "ACTIVE_OPERATION", text: "Ada tahap yang sedang berjalan atau ditunda — selesaikan atau lanjutkan dulu" });
  if (openShortage) out.push({ code: "OPEN_SHORTAGE", text: "Menunggu bahan dari Gudang — selesaikan masalah bahan dulu" });
  if (exceptionOpen) out.push({ code: "EXCEPTION_OPEN", text: "Ada konflik data yang harus diselesaikan Production Lead" });
  if (run.phases?.some((p) => p.status === "BLOCKED")) out.push({ code: "PHASE_BLOCKED", text: "Ada fase run yang terhenti — tindak lanjut lewat Production Lead" });
  return out;
}

// Selesaikan Produksi: SEMUA tahap tersisa dicatat SKIPPED secara eksplisit (QC: "tidak dilakukan"), fase QC/HANDOFF ditutup NOT_APPLICABLE (bukan COMPLETED palsu, tanpa
// custody barang jadi), run COMPLETED, lalu unit READY_FOR_DELIVERY lewat jalur engine yang SAMA (saran job Delivery idempoten: tanpa job ganda). Pemanggil sudah memvalidasi.
export async function applyAdaptationFinishInTx(tx, { run, actorId, now = new Date() }) {
  const skipped = []; let qcNotPerformed = false;
  let current = run;
  for (let guard = 0; guard < 40; guard += 1) {
    const unit = await tx.unit.findUniqueOrThrow({ where: { id: run.unitId }, select: { id: true, serviceId: true, currentStageId: true, status: true, orderId: true } });
    const path = await pathForUnit(tx, unit);
    const { stage, state } = await resolveCurrentTarget(tx, unit, path);
    if (state === "DONE") break;
    if (!stage || !["FIRST", "READY"].includes(state)) throw workError("Tahap unit tidak dapat ditutup otomatis pada keadaan ini — perlu penanganan Production Lead", 409, "WORKSHOP_FINISH_STAGE_STATE", { state });
    const qc = !!stage.requiresQc;
    await viaEngine(() => skipStageForAdaptationInTx(tx, run.unitId, stage.id, { actorId, note: "Selesaikan Produksi.", deferReady: true, qcNotPerformed: qc }));
    await recordSkippedOperation(tx, { run: current, stage, now, qcNotPerformed: qc });
    skipped.push({ id: stage.id, code: stage.code, label: stage.labelId, phase: stage.phase, qcNotPerformed: qc });
    if (qc) qcNotPerformed = true;
    current = await tx.productionRun.findUniqueOrThrow({ where: { id: run.id }, include: RUN_INCLUDE });
  }
  const fresh = await tx.productionRun.findUniqueOrThrow({ where: { id: run.id }, include: { phases: true } });
  const reasonQc = "QC tidak dilakukan (mode adaptasi) — bukan lulus dan bukan di-waive";
  const reasonHandoff = "Penerimaan barang jadi Gudang tidak diwajibkan (mode adaptasi); tidak ada custody ACCEPTED";
  const phaseUpdates = [];
  for (const phase of fresh.phases) {
    if (PHASE_TERMINAL_STATUSES.includes(phase.status)) continue;
    if (phase.phase === "QC") phaseUpdates.push({ phase: "QC", data: { status: "NOT_APPLICABLE", reason: reasonQc } });
    else if (phase.phase === "HANDOFF") phaseUpdates.push({ phase: "HANDOFF", data: { status: "NOT_APPLICABLE", reason: reasonHandoff } });
    else if (phase.status === "ACTIVE") phaseUpdates.push({ phase: phase.phase, data: { status: "COMPLETED", completedAt: now } });
    else phaseUpdates.push({ phase: phase.phase, data: { status: "NOT_APPLICABLE", reason: "Dilewati — Selesaikan Produksi (mode adaptasi)" } });
  }
  if (phaseUpdates.length) await transitionPhases(tx, run.id, phaseUpdates);
  // Penutupan run + pelepasan ke Delivery = milik custody service (ownership run COMPLETED/READY_FOR_DELIVERY); P5 hanya menutup fase dan memanggilnya.
  const closed = await viaEngine(() => completeAdaptationRunInTx(tx, { runId: run.id, actorId, now }));
  return { runId: run.id, revision: closed.revision, skipped, qcNotPerformed, unitStatus: closed.unitStatus };
}

// Gerbang QC pada run adaptasi: dicatat TIDAK DILAKUKAN (ledger SKIP berkatalog + operasi SKIPPED). Dipanggil saat tahap 9 (Kirim ke Corner). Unit maju ke tahap Corner.
export async function applyQcNotPerformedInTx(tx, { run, actorId, now = new Date() }) {
  assertAdaptationRun(run);
  const path = await pathForUnit(tx, run.unit);
  const { stage, state } = await resolveCurrentTarget(tx, run.unit, path);
  if (!stage?.requiresQc || !["FIRST", "READY"].includes(state)) throw workError("Unit tidak sedang berada di gerbang QC", 409, "WORKSHOP_QC_GATE_NOT_CURRENT", { state });
  if (activeOperation(run)) throw workError("Masih ada tahap berjalan/ditunda pada run ini", 409, "WORKSHOP_STAGE_ALREADY_ACTIVE");
  await viaEngine(() => skipStageForAdaptationInTx(tx, run.unitId, stage.id, { actorId, note: "Kirim ke Corner.", deferReady: true, qcNotPerformed: true }));
  await recordSkippedOperation(tx, { run, stage, now, qcNotPerformed: true });
  return { stage: { id: stage.id, code: stage.code, label: stage.labelId } };
}

// Tunda Pekerjaan pada pekerjaan di papan (ARAHAN/KENDALA/LAINNYA): jeda SAH P5 (PROCESS_DELAY) + penanda alasan di operasi. BAHAN tetap lewat laporan kekurangan bahan.
export async function applyDelayInTx(tx, { run, op, actorId, kind, label, note = null }) {
  const pauseNote = `Tunda Pekerjaan — ${label}${note ? `: ${note}` : ""}`;
  const result = await applyPauseInTx(tx, { run, op, actorId, reason: "PROCESS_DELAY", note: pauseNote });
  await tx.productionOperationRun.update({ where: { id: op.id }, data: { delayKind: kind, delayNote: note || null } });
  return { ...result, delayKind: kind };
}

// ---------------------------------------------------------------------------
// Bacaan (digerbang flag reader di layer routes).
// ---------------------------------------------------------------------------
function endOfTodayWIB(now = new Date()) {
  const shifted = new Date(now.getTime() + 7 * 3600_000);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() + 1) - 7 * 3600_000);
}

function queueState(run) {
  if (phaseOf(run, "HANDOFF")?.status === "BLOCKED") return "HANDOFF_REJECTED";
  const process = phaseOf(run, "PROCESS");
  if (process?.status === "COMPLETED") return run.currentPhase === "HANDOFF" ? "IN_HANDOFF" : "AWAITING_QC";
  const op = activeOperation(run);
  if (op) return op.status === "PAUSED" ? "PAUSED" : "IN_PROGRESS";
  return "READY_TO_START";
}

// Antrean kerja: run non-terminal dengan material sudah ISSUED. scope=today -> target mulai <= akhir hari ini (WIB); mine -> hanya milik operator.
export async function listWorkshopQueue(prisma, { unitIds = null, operatorUserId = null, scope = "today", limit = 100, now = new Date() } = {}) {
  const runs = await prisma.productionRun.findMany({
    where: {
      status: { notIn: TERMINAL_RUN },
      plan: {
        is: {
          status: "MATERIAL_RESERVED",
          materialIssues: { some: { status: "ISSUED" } },
          ...(scope === "today" ? { targetStartAt: { lt: endOfTodayWIB(now) } } : {}),
          ...(operatorUserId ? { operator: { is: { userId: operatorUserId } } } : {}),
        },
      },
      ...(unitIds ? { unitId: { in: unitIds } } : {}),
    },
    include: RUN_INCLUDE,
    orderBy: [{ createdAt: "asc" }],
    take: Math.min(Math.max(Number(limit) || 100, 1), 200),
  });
  return runs
    .filter((run) => {
      const process = phaseOf(run, "PROCESS");
      return process && process.status !== "NOT_APPLICABLE";
    })
    .map((run) => ({
      runId: run.id, revision: run.revision, origin: run.origin, state: queueState(run),
      unit: { id: run.unit.id, unitCode: run.unit.unitCode, orderNumber: run.unit.order?.orderNumber ?? null },
      workCenter: run.plan.workCenter, operator: run.plan.operator ? { id: run.plan.operator.id, name: run.plan.operator.user?.name ?? null } : null,
      targetStartAt: run.plan.targetStartAt, targetCompleteAt: run.plan.targetCompleteAt,
      currentStage: activeOperation(run) ? { id: activeOperation(run).stageId, label: activeOperation(run).stageLabel, status: activeOperation(run).status } : null,
      completedStages: run.operations.filter((op) => op.status === "COMPLETED").length,
    }));
}

// Detail: tahap workshop (dari jalur routing V1) + status per tahap + histori aktivitas dari ledger tahap.
export async function getWorkshopRun(prisma, runId) {
  const run = await prisma.productionRun.findUnique({ where: { id: runId }, include: RUN_INCLUDE });
  if (!run) return null;
  let fullPath = [];
  let executableStages = [];
  let qcStage = null;
  let pathError = null;
  try {
    const path = await pathForUnit(prisma, run.unit);
    ({ qcStage, executable: executableStages } = workshopPathOf(path));
    fullPath = path;
  } catch (error) { pathError = error.message; }
  const byStage = new Map(run.operations.map((op) => [op.stageId, op]));
  const stageIds = executableStages.map((s) => s.id);
  const qcPhase = phaseOf(run, "QC");
  const qcGateStatus = qcPhase?.status === "COMPLETED" ? "COMPLETED" : (phaseOf(run, "PROCESS")?.status === "COMPLETED" && run.currentPhase === "QC") ? "AWAITING_QC" : "NOT_STARTED";
  const logs = stageIds.length
    ? await prisma.unitStageLog.findMany({
        where: { unitId: run.unitId, stageId: { in: stageIds }, createdAt: { gte: run.createdAt } }, orderBy: { createdAt: "asc" },
        include: { stage: { select: { labelId: true } }, actor: { select: { name: true } } },
      })
    : [];
  const facts = run.plan ? await loadMaterialFacts(prisma, run.plan) : null;
  const readiness = run.plan ? materialReadiness({ plan: run.plan, ...facts }) : { ready: false, reason: "Belum ada rencana" };
  return {
    runId: run.id, revision: run.revision, origin: run.origin, state: queueState(run), pathError,
    unit: { id: run.unit.id, unitCode: run.unit.unitCode, orderNumber: run.unit.order?.orderNumber ?? null, serviceId: run.unit.serviceId },
    plan: run.plan ? { id: run.plan.id, status: run.plan.status, workCenter: run.plan.workCenter, operator: run.plan.operator ? { id: run.plan.operator.id, name: run.plan.operator.user?.name ?? null } : null, targetStartAt: run.plan.targetStartAt, targetCompleteAt: run.plan.targetCompleteAt } : null,
    material: readiness,
    stages: fullPath.map((stage, index) => {
      if (stage.requiresQc) return { id: stage.id, code: stage.code, label: stage.labelId, order: index + 1, requiresPhoto: !!stage.requiresPhoto, required: true, isQcGate: true, status: qcGateStatus, startedAt: null, completedAt: qcGateStatus === "COMPLETED" ? qcPhase.completedAt : null };
      const op = byStage.get(stage.id);
      return { id: stage.id, code: stage.code, label: stage.labelId, order: index + 1, requiresPhoto: !!stage.requiresPhoto, required: !stage.isOptional, isQcGate: false, status: op?.status ?? "NOT_STARTED", startedAt: op?.startedAt ?? null, completedAt: op?.completedAt ?? null };
    }),
    qcGate: qcStage ? { id: qcStage.id, label: qcStage.labelId } : null,
    history: logs.map((log) => ({ id: log.id, action: log.action, stage: log.stage.labelId, actor: log.actor?.name ?? null, at: log.createdAt, pauseReason: log.pauseReason, note: log.note, photoUrls: log.photoUrls })),
  };
}
