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
import { BOARD_DEFAULTS, assertStationCapacity, formatProductionDate, normalizeScheduleInput, parseProductionDate, workWindowFor } from "../lib/domain/productionBoard.js";
import { signUnitPhotoUrlIfAny, signUnitPhotoUrlsBulk } from "../routes/productionUnitPhoto.js";
import { assertNoV1Drift } from "./productionRunGuards.js";

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
export async function createProductionPlan(prisma, args) {
  return prisma.$transaction((tx) => createProductionPlanInTx(tx, args));
}

// Varian di dalam transaksi pemanggil (Rencana: buka Run + buat rencana + jadwalkan = SATU commit). Isi command TIDAK berubah.
export async function createProductionPlanInTx(tx, { runId, actorId, idempotencyKey }) {
  if (!runId) throw planError("runId wajib diisi", 400, "PLAN_RUN_ID_REQUIRED");
  assertIdempotencyKey(idempotencyKey);
  const actor = actorId || "SYSTEM";
  const requestHash = hash({ commandType: "CREATE_PLAN", runId });

  return (async () => {
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
    // P9A (One-Location Production Intake) — run.status === PENDING_ARRIVAL ikut
    // eligible: unit yang pickup-nya berhasil boleh DIRENCANAKAN (tanggal, meja,
    // PIC, prioritas) SEBELUM tiba secara fisik di workshop. Tahap produksi
    // sendiri TETAP tidak bisa dimulai sebelum kedatangan dikonfirmasi — gerbang
    // terpisah di loadRunForWrite (productionWorkshopExecutionCommandService.js),
    // BUKAN di sini (di sini cuma soal boleh/tidaknya rencana dibuat).
    const eligible = run.custodyHandoffs.length > 0 || !!run.migrationSource || run.origin === "WORKSHOP_BORN" || run.status === "PENDING_ARRIVAL";
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
  })();
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
  await assertNoV1Drift(tx, { runId: plan.run.id, unitId: plan.run.unitId }); // rollback writer OFF -> aksi V1 -> writer ON: berhenti sampai direkonsiliasi
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
// 2b. P8 — Jadwalkan ke papan meja (Planner H-1): tanggal produksi, meja bongkar, prioritas, PIC meja + work center, dan PIC Corner opsional.
//     Superset assign: DRAFT -> PLANNED; target mulai/selesai diisi jendela kerja tanggal produksi (08.00–17.00 WIB). Kapasitas meja
//     (default 3) dijaga di dalam transaksi setelah mengunci plan. Keluarkan dari papan = productionDate & stationCode null.
//     Mengganti PIC saat masih ada tahap aktif/dijeda ditolak (operasi berjalan milik PIC lama).
// ---------------------------------------------------------------------------
export async function scheduleProductionPlan(prisma, args) {
  return prisma.$transaction((tx) => scheduleProductionPlanInTx(tx, args));
}

// Varian di dalam transaksi pemanggil (lihat createProductionPlanInTx). Validasi input tetap dilakukan SEBELUM menyentuh DB.
export async function scheduleProductionPlanInTx(tx, { planId, actorId, idempotencyKey, expectedRevision, config = BOARD_DEFAULTS, ...input }) {
  assertIdempotencyKey(idempotencyKey);
  const revisionExpected = assertExpectedRevision(expectedRevision);
  const data = normalizeScheduleInput(input, config);
  const actor = actorId || "SYSTEM";
  const requestHash = hash({
    commandType: "SCHEDULE_PLAN", planId, expectedRevision: revisionExpected, ...data,
    productionDate: data.productionDate ? formatProductionDate(data.productionDate) : null,
  });

  return (async () => {
    const replay = await findReplay(tx, actor, idempotencyKey, requestHash);
    if (replay) return replay;
    const plan = await loadPlanForWrite(tx, planId);
    assertPlanNotCancelled(plan);
    assertPlanRevision(plan, revisionExpected);
    await assertWriterEnabledForUnit(tx, plan.run.unitId);

    const now = new Date();
    let update;
    if (data.unschedule) {
      update = { productionDate: null, stationCode: null, stationSequence: null, priority: data.priority };
    } else {
      const workCenter = await tx.workCenter.findUnique({ where: { id: data.workCenterId } });
      if (!workCenter || !workCenter.active) throw planError("Workshop/work center tidak valid atau nonaktif", 422, "PLAN_WORK_CENTER_INVALID");
      const operator = await tx.productionOperator.findUnique({ where: { id: data.operatorId } });
      if (!operator || !operator.active) throw planError("PIC meja tidak valid atau nonaktif", 422, "PLAN_OPERATOR_INVALID");
      if (data.cornerOperatorId) {
        const corner = await tx.productionOperator.findUnique({ where: { id: data.cornerOperatorId } });
        if (!corner || !corner.active) throw planError("PIC Corner tidak valid atau nonaktif", 422, "PLAN_CORNER_OPERATOR_INVALID");
      }
      if (data.cornerWorkCenterId) {
        const cornerCenter = await tx.workCenter.findUnique({ where: { id: data.cornerWorkCenterId } });
        if (!cornerCenter || !cornerCenter.active) throw planError("Work center Corner tidak valid atau nonaktif", 422, "PLAN_CORNER_WORK_CENTER_INVALID");
      }
      const operatorChanged = plan.operatorId !== data.operatorId || (plan.cornerOperatorId || null) !== data.cornerOperatorId;
      if (operatorChanged) {
        const running = await tx.productionOperationRun.count({ where: { runId: plan.runId, status: { in: ["ACTIVE", "PAUSED"] } } });
        if (running > 0) throw planError("Masih ada tahap yang sedang dikerjakan/dijeda; selesaikan dulu sebelum mengganti PIC", 409, "PLAN_RUN_IN_PROGRESS");
      }
      const sameSlot = plan.productionDate && formatProductionDate(plan.productionDate) === formatProductionDate(data.productionDate) && plan.stationCode === data.stationCode;
      let stationSequence = sameSlot ? (plan.stationSequence ?? null) : null;
      if (!sameSlot) {
        // Kunci slot (tanggal, meja) lewat advisory lock transaksi: dua penjadwalan bersamaan ke slot yang sama diserialkan TANPA mengunci
        // baris plan lain (tidak ada siklus kunci dengan command yang mengunci plan-nya sendiri lebih dulu).
        await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))::text AS k", `production-station:${formatProductionDate(data.productionDate)}:${data.stationCode}`);
        const occupied = await tx.productionRunPlan.count({
          where: { id: { not: planId }, productionDate: data.productionDate, stationCode: data.stationCode, status: { not: "CANCELLED" } },
        });
        assertStationCapacity(occupied, config);
        // Slot sudah punya urutan MANUAL -> unit baru ditaruh di akhir (max+1); slot tanpa urutan manual -> NULL (urutan bawaan = prioritas).
        const top = await tx.productionRunPlan.aggregate({ where: { id: { not: planId }, productionDate: data.productionDate, stationCode: data.stationCode, status: { not: "CANCELLED" } }, _max: { stationSequence: true } });
        stationSequence = top._max.stationSequence != null ? top._max.stationSequence + 1 : null;
      }
      const window = workWindowFor(data.productionDate, config);
      update = {
        productionDate: data.productionDate, stationCode: data.stationCode, stationSequence, priority: data.priority,
        workCenterId: data.workCenterId, operatorId: data.operatorId,
        cornerWorkCenterId: data.cornerWorkCenterId, cornerOperatorId: data.cornerOperatorId,
        targetStartAt: window.targetStartAt, targetCompleteAt: window.targetCompleteAt,
        status: plan.status === "DRAFT" ? "PLANNED" : plan.status,
        plannedById: plan.plannedAt ? plan.plannedById : (actorId || null), plannedAt: plan.plannedAt || now,
      };
    }
    const revision = plan.revision + 1;
    const command = await beginCommand(tx, { actor, idempotencyKey, commandType: "SCHEDULE_PLAN", aggregateType: "ProductionRunPlan", aggregateId: planId, requestHash, expectedRevision: revisionExpected });
    const updated = await tx.productionRunPlan.update({ where: { id: planId }, data: { ...update, revision, commandId: command.id } });
    const productionDate = formatProductionDate(updated.productionDate);
    await outbox(tx, {
      eventType: data.unschedule ? "production.plan.unscheduled" : "production.plan.scheduled", aggregateType: "ProductionRunPlan", aggregateId: planId, revision,
      dedupeKey: `production-plan-scheduled:${planId}:${revision}`,
      payload: { planId, runId: plan.runId, unitId: plan.run.unitId, productionDate, stationCode: updated.stationCode, priority: updated.priority, operatorId: updated.operatorId, cornerOperatorId: updated.cornerOperatorId, revision, occurredAt: now.toISOString(), actorId },
    });
    await recordActivity(tx, {
      entityType: "unit", entityId: plan.run.unitId, eventType: EVENT_TYPES.PRODUCTION_PLAN_ASSIGNED, actorId: actorId || null,
      metadata: { unitCode: plan.run.unit.unitCode, planId, productionDate, stationCode: updated.stationCode, priority: updated.priority, scheduled: !data.unschedule },
    });
    const response = {
      planId, status: updated.status, revision, productionDate, stationCode: updated.stationCode, priority: updated.priority,
      workCenterId: updated.workCenterId, operatorId: updated.operatorId, cornerWorkCenterId: updated.cornerWorkCenterId, cornerOperatorId: updated.cornerOperatorId,
    };
    await finishCommand(tx, command, revision, response);
    return { replayed: false, ...response };
  })();
}

// ---------------------------------------------------------------------------
// 2b. Atur URUTAN MANUAL unit dalam satu meja pada satu tanggal (drag-drop / tombol naik-turun di Rencana Produksi).
//     Mengirim DAFTAR LENGKAP plan (id) di slot itu menurut urutan baru — server menolak (409 STATION_ORDER_STALE) bila himpunan plan
//     di slot berbeda dari yang dilihat klien (ada yang masuk/keluar/dibatalkan sejak dimuat), jadi urutan tidak pernah menimpa
//     perubahan orang lain diam-diam. Slot dikunci advisory lock YANG SAMA dengan penjadwalan (serial dengan "Jadwalkan/Pindahkan").
//     Hanya baris yang nomornya BERUBAH yang dinaikkan revisinya. Prioritas TIDAK disentuh (urutan manual menang atas prioritas;
//     prioritas hanya urutan bawaan saat belum ada urutan manual). Tidak mengubah kapasitas/jadwal/PIC.
// ---------------------------------------------------------------------------
export async function reorderStationPlans(prisma, { actorId, idempotencyKey, productionDate, stationCode, orderedPlanIds, config = BOARD_DEFAULTS }) {
  assertIdempotencyKey(idempotencyKey);
  const parsedDate = parseProductionDate(productionDate);
  if (!parsedDate) throw planError("Tanggal produksi wajib diisi dengan format YYYY-MM-DD", 400, "PLAN_PRODUCTION_DATE_INVALID");
  if (!config.stations.includes(stationCode)) throw planError("Meja tidak dikenal", 400, "PLAN_STATION_INVALID", { stations: config.stations });
  const data = { productionDate: parsedDate, stationCode };
  if (!Array.isArray(orderedPlanIds) || orderedPlanIds.length === 0 || orderedPlanIds.some((id) => typeof id !== "string") || new Set(orderedPlanIds).size !== orderedPlanIds.length) {
    throw planError("orderedPlanIds wajib berisi daftar id plan unik di meja ini", 400, "STATION_ORDER_INVALID");
  }
  const actor = actorId || "SYSTEM";
  const dateKey = formatProductionDate(data.productionDate);
  const requestHash = hash({ commandType: "REORDER_STATION", productionDate: dateKey, stationCode: data.stationCode, orderedPlanIds });

  return prisma.$transaction(async (tx) => {
    const replay = await findReplay(tx, actor, idempotencyKey, requestHash);
    if (replay) return replay;
    await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))::text AS k", `production-station:${dateKey}:${data.stationCode}`);
    const plans = await tx.productionRunPlan.findMany({
      where: { productionDate: data.productionDate, stationCode: data.stationCode, status: { not: "CANCELLED" } },
      include: { run: { select: { unitId: true, unit: { select: { unitCode: true } } } } },
    });
    const have = plans.map((p) => p.id).sort();
    const want = [...orderedPlanIds].sort();
    if (have.length !== want.length || have.some((id, i) => id !== want[i])) {
      throw planError("Isi meja ini berubah sejak dimuat (ada unit masuk/keluar). Muat ulang lalu atur urutan lagi.", 409, "STATION_ORDER_STALE", { currentPlanIds: have });
    }
    for (const p of plans) await assertWriterEnabledForUnit(tx, p.run.unitId);

    const byId = new Map(plans.map((p) => [p.id, p]));
    const command = await beginCommand(tx, { actor, idempotencyKey, commandType: "REORDER_STATION", aggregateType: "ProductionStation", aggregateId: `${dateKey}:${data.stationCode}`, requestHash });
    const changed = [];
    for (let i = 0; i < orderedPlanIds.length; i += 1) {
      const p = byId.get(orderedPlanIds[i]);
      const seq = i + 1;
      if (p.stationSequence === seq) continue;
      await lockRowForUpdate(tx, "production_run_plans_v2", p.id);
      const revision = p.revision + 1;
      await tx.productionRunPlan.update({ where: { id: p.id }, data: { stationSequence: seq, revision, commandId: command.id } });
      changed.push({ planId: p.id, unitId: p.run.unitId, unitCode: p.run.unit.unitCode, sequence: seq, revision });
    }
    const response = { productionDate: dateKey, stationCode: data.stationCode, orderedPlanIds, changedCount: changed.length };
    await outbox(tx, {
      eventType: "production.station.reordered", aggregateType: "ProductionStation", aggregateId: `${dateKey}:${data.stationCode}`, revision: 1,
      dedupeKey: `production-station-reordered:${command.id}`,
      payload: { ...response, changed, occurredAt: new Date().toISOString(), actorId: actorId || null },
    });
    for (const c of changed) {
      await recordActivity(tx, {
        entityType: "unit", entityId: c.unitId, eventType: EVENT_TYPES.PRODUCTION_STATION_REORDERED, actorId: actorId || null,
        metadata: { unitCode: c.unitCode, planId: c.planId, productionDate: dateKey, stationCode: data.stationCode, sequence: c.sequence },
      });
    }
    await finishCommand(tx, command, 1, response);
    return { replayed: false, ...response };
  });
}

// ---------------------------------------------------------------------------
// 3. Susun/ubah Planned BOM (full-replace). Mengubah BOM saat sudah MATERIAL_RESERVED melepas SEMUA reservasi
//    aktif milik plan ini dalam transaksi yang SAMA (tidak pernah meninggalkan saldo reservasi yatim) dan
//    mengembalikan status ke PLANNED — reservasi ulang harus dipanggil eksplisit lagi.
// ---------------------------------------------------------------------------
// Inti "susun/ubah Planned BOM" TANPA transaksi/idempotency sendiri — dipakai ULANG oleh setPlannedBOM (di
// bawah, membungkusnya dengan transaksi+command SET_PLANNED_BOM sendiri) DAN oleh
// productionDiagnosisCommandService.js (P9D) di dalam TRANSAKSI YANG SAMA dengan command SUBMIT_DIAGNOSIS-nya
// sendiri — pola "InTx" SAMA dengan reserveSupplementalInTx/releaseReservationsInTx di file ini. `plan` HARUS
// sudah dimuat+dikunci (loadPlanForWrite) oleh pemanggil; command yang membungkus (`command`) dipakai untuk
// commandId pada baris yang ditulis, BUKAN dibuat di sini.
export async function setPlannedBOMInTx(tx, { plan, lines, actorId, commandId = null }) {
  assertPlanBOMLines(lines);
  assertPlanNotCancelled(plan);
  await assertNoBlockingMaterialIssue(tx, plan.id);
  const normalized = lines.map((l) => ({ materialId: l.materialId, qty: Number(l.qty) }));

  const materials = await tx.material.findMany({ where: { id: { in: normalized.map((l) => l.materialId) } } });
  const byId = new Map(materials.map((m) => [m.id, m]));
  for (const line of normalized) {
    const material = byId.get(line.materialId);
    if (!material) throw planError("Material tidak ditemukan", 404, "PLAN_BOM_MATERIAL_NOT_FOUND", { materialId: line.materialId });
    if (!material.active) throw planError(`Material ${material.code} sudah nonaktif`, 422, "PLAN_BOM_MATERIAL_INACTIVE", { materialId: line.materialId });
  }

  const now = new Date();
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
      data: { planId: plan.id, materialId: line.materialId, qty: line.qty, unit: material.unit, status: "ACTIVE", revision: 1, createdById: actorId || null },
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
        payload: { reservationId: reservation.id, planId: plan.id, materialId: reservation.materialId, reason: "Planned BOM diubah", occurredAt: now.toISOString(), actorId },
      });
      releasedCount += 1;
    }
    nextStatus = "PLANNED";
  }

  const revision = plan.revision + 1;
  await tx.productionRunPlan.update({ where: { id: plan.id }, data: { revision, status: nextStatus, commandId } });
  await outbox(tx, {
    eventType: "production.plan.bom_set", aggregateType: "ProductionRunPlan", aggregateId: plan.id, revision,
    dedupeKey: `production-plan-bom-set:${plan.id}:${revision}`,
    payload: { planId: plan.id, runId: plan.runId, unitId: plan.run.unitId, lines: normalized, releasedReservations: releasedCount, revision, occurredAt: now.toISOString(), actorId },
  });
  await recordActivity(tx, {
    entityType: "unit", entityId: plan.run.unitId, eventType: EVENT_TYPES.PRODUCTION_PLAN_BOM_SET, actorId: actorId || null,
    metadata: { unitCode: plan.run.unit.unitCode, planId: plan.id, lineCount: normalized.length, releasedReservations: releasedCount },
  });
  return { planId: plan.id, status: nextStatus, revision, lineCount: normalized.length, releasedReservations: releasedCount };
}

// `authorize` (opsional): dipanggil di DALAM transaksi, setelah plan terkunci & revisi cocok, SEBELUM command dicatat — dipakai pemanggil yang punya aturan akses sendiri (mis. PIC Bahan per pekerjaan)
// tanpa membuat penulis BOM kedua. Tanpa authorize: perilaku lama persis.
export async function setPlannedBOM(prisma, { planId, actorId, idempotencyKey, expectedRevision, lines, authorize = null }) {
  assertIdempotencyKey(idempotencyKey);
  const revisionExpected = assertExpectedRevision(expectedRevision);
  const actor = actorId || "SYSTEM";
  const normalized = lines.map((l) => ({ materialId: l.materialId, qty: Number(l.qty) }));
  const requestHash = hash({ commandType: "SET_PLANNED_BOM", planId, expectedRevision: revisionExpected, lines: [...normalized].sort((a, b) => a.materialId.localeCompare(b.materialId)) });

  return prisma.$transaction(async (tx) => {
    const replay = await findReplay(tx, actor, idempotencyKey, requestHash);
    if (replay) return replay;
    const plan = await loadPlanForWrite(tx, planId);
    assertPlanRevision(plan, revisionExpected);
    await assertWriterEnabledForUnit(tx, plan.run.unitId);
    if (authorize) await authorize(tx, plan);

    const command = await beginCommand(tx, { actor, idempotencyKey, commandType: "SET_PLANNED_BOM", aggregateType: "ProductionRunPlan", aggregateId: planId, requestHash, expectedRevision: revisionExpected });
    const response = await setPlannedBOMInTx(tx, { plan, lines, actorId, commandId: command.id });
    await finishCommand(tx, command, response.revision, response);
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
// P6. Bahan TAMBAHAN rework (supplemental). Dipanggil command QC V2 (productionQcHandoffCommandService.js) di dalam TRANSAKSI-nya
// sendiri; `plan` HARUS sudah dimuat+dikunci (loadPlanForWrite). Reservasi ASLI (CONSUMED) TIDAK PERNAH dibuka/diubah: baris BOM
// tambahan terhubung ke inspeksi QC yang gagal, availability/reservasi memakai jalur yang SAMA dengan P3 (availableForMaterial, kunci
// material ascending). Kekurangan stok untuk material APA PUN membatalkan seluruh transaksi pemanggil.
// ---------------------------------------------------------------------------
export async function reserveSupplementalInTx(tx, { plan, inspectionId, lines, actorId, commandId }) {
  assertPlanBOMLines(lines);
  if (plan.status !== "MATERIAL_RESERVED") throw planError("Bahan tambahan hanya dapat diajukan untuk rencana berstatus Bahan Direservasi", 409, "PLAN_NOT_MATERIAL_RESERVED", { status: plan.status });
  const sorted = [...lines].map((l) => ({ materialId: l.materialId, qty: Number(l.qty) })).sort((a, b) => a.materialId.localeCompare(b.materialId));
  const materials = await tx.material.findMany({ where: { id: { in: sorted.map((l) => l.materialId) } } });
  const byId = new Map(materials.map((m) => [m.id, m]));
  for (const line of sorted) {
    const material = byId.get(line.materialId);
    if (!material) throw planError("Material tidak ditemukan", 404, "PLAN_BOM_MATERIAL_NOT_FOUND", { materialId: line.materialId });
    if (!material.active) throw planError(`Material ${material.code} sudah nonaktif`, 422, "PLAN_BOM_MATERIAL_INACTIVE", { materialId: line.materialId });
  }
  const shortages = [];
  for (const line of sorted) {
    const available = await availableForMaterial(tx, line.materialId);
    if (line.qty > available + EPSILON) {
      shortages.push({ materialId: line.materialId, code: byId.get(line.materialId).code, needed: line.qty, available: Math.max(available, 0) });
    }
  }
  if (shortages.length > 0) {
    const detail = shortages.map((s) => `${s.code} (butuh ${s.needed}, tersedia ${s.available})`).join("; ");
    throw planError(`Stok tidak cukup untuk bahan tambahan: ${detail}`, 409, "PLAN_MATERIAL_SHORTAGE", { shortages });
  }
  const now = new Date();
  const reservations = [];
  for (const line of sorted) {
    const bomLine = await tx.plannedBOMLine.create({
      data: { planId: plan.id, materialId: line.materialId, qty: line.qty, unit: byId.get(line.materialId).unit, status: "ACTIVE", revision: 1, createdById: actorId || null, supplementalInspectionId: inspectionId },
    });
    const reservation = await tx.materialReservation.create({
      data: { bomLineId: bomLine.id, planId: plan.id, materialId: line.materialId, qty: line.qty, status: "ACTIVE", reservedById: actorId || null, reservedAt: now, commandId },
    });
    await outbox(tx, {
      eventType: "production.reservation.created", aggregateType: "MaterialReservation", aggregateId: reservation.id, revision: 1,
      dedupeKey: `production-reservation-created:${reservation.id}`,
      payload: { reservationId: reservation.id, planId: plan.id, runId: plan.runId, unitId: plan.run.unitId, materialId: line.materialId, qty: line.qty, supplementalInspectionId: inspectionId, occurredAt: now.toISOString(), actorId },
    });
    reservations.push({ reservationId: reservation.id, bomLineId: bomLine.id, materialId: line.materialId, qty: line.qty });
  }
  await tx.productionRunPlan.update({ where: { id: plan.id }, data: { revision: plan.revision + 1 } });
  return { reservations };
}

// Pembatalan bahan tambahan sebelum diserahkan (issue tambahan dibatalkan): lepas reservasi AKTIF milik inspeksi itu dan batalkan baris BOM
// tambahannya. Status plan TIDAK berubah (reservasi asli tetap CONSUMED).
export async function cancelSupplementalInTx(tx, { plan, inspectionId, actorId, reason }) {
  const now = new Date();
  const lines = await tx.plannedBOMLine.findMany({ where: { planId: plan.id, supplementalInspectionId: inspectionId, status: "ACTIVE" } });
  let released = 0;
  for (const line of lines) {
    const reservations = await tx.materialReservation.findMany({ where: { bomLineId: line.id, status: "ACTIVE" } });
    for (const reservation of reservations) {
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
    await tx.plannedBOMLine.update({ where: { id: line.id }, data: { status: "CANCELLED", supersededById: actorId || null, supersededAt: now, revision: line.revision + 1 } });
  }
  await tx.productionRunPlan.update({ where: { id: plan.id }, data: { revision: plan.revision + 1 } });
  return { releasedCount: released };
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
        { origin: "WORKSHOP_BORN" },
        // P9A — unit "Masuk Produksi" (Dalam perjalanan) BOLEH direncanakan
        // sebelum kedatangan fisik dikonfirmasi (lihat catatan panjang di
        // createProductionPlan di atas).
        { status: "PENDING_ARRIVAL" },
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
  const eligible = runs.filter((run) => !run.phases[0] || !["ACTIVE", "COMPLETED"].includes(run.phases[0].status));
  // P9B.1 — foto identitas unit untuk kartu "Belum Direncanakan" di Rencana Produksi, satu panggilan batch.
  const photoByUnit = await signUnitPhotoUrlsBulk(prisma, eligible.map((run) => run.unit.id));
  return eligible.map((run) => ({
    runId: run.id, unit: { id: run.unit.id, unitCode: run.unit.unitCode, merk: run.unit.merk, ukuran: run.unit.ukuran, storageLocation: run.unit.storageLocation, orderNumber: run.unit.order?.orderNumber ?? null, photoUrl: photoByUnit.get(run.unit.id) ?? null },
    kind: run.kind, isLegacyException: !!run.migrationSource,
    // P9A — kartu tetap "Rencanakan" seperti biasa, TAPI UI perlu tahu unit
    // ini belum tiba secara fisik (badge "Dalam perjalanan ke workshop") supaya
    // tidak menyiratkan siap dikerjakan segera setelah dijadwalkan.
    inTransit: run.status === "PENDING_ARRIVAL",
  }));
}

// P9B.1 — workspace baru "Rencana Produksi" butuh customer/layanan/prioritas/tanggal produksi/meja/PIC Corner yang
// SUDAH ADA di baris ProductionRunPlan/Unit (dipakai scheduleProductionPlan sejak P9B) tapi TIDAK PERNAH di-select
// di sini (formatPlan/getProductionPlans ini lebih tua, dari P3 sebelum kolom itu ada). Tambahan READ-ONLY murni —
// TIDAK ada kolom/tabel baru, TIDAK ada command baru, TIDAK mengubah cara scheduleProductionPlan menulis.
const PLAN_LIST_INCLUDE = {
  run: {
    select: {
      id: true, unitId: true, kind: true,
      unit: {
        select: {
          id: true, unitCode: true, merk: true, ukuran: true, serviceId: true,
          service: { select: { code: true, labelId: true } },
          order: { select: { orderNumber: true, customer: { select: { name: true, city: true, assignedSales: { select: { name: true } } } } } },
        },
      },
    },
  },
  workCenter: { select: { id: true, code: true, name: true } },
  operator: { select: { id: true, userId: true, employeeCode: true, user: { select: { name: true } } } },
  cornerWorkCenter: { select: { id: true, code: true, name: true } },
  cornerOperator: { select: { id: true, userId: true, employeeCode: true, user: { select: { name: true } } } },
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
  // P9B.1 — foto identitas unit untuk kartu "Direncanakan"/"Bahan Direservasi", satu panggilan batch.
  const photoByUnit = await signUnitPhotoUrlsBulk(prisma, rows.map((r) => r.run.unit.id));
  return rows.map((row) => formatPlan(row, photoByUnit.get(row.run.unit.id) ?? null));
}

export async function getProductionPlan(prisma, planId) {
  const row = await prisma.productionRunPlan.findUnique({ where: { id: planId }, include: PLAN_LIST_INCLUDE });
  if (!row) return null;
  return formatPlan(row, await signUnitPhotoUrlIfAny(prisma, row.run.unit.id));
}

function formatPlan(row, photoUrl = null) {
  const unit = row.run.unit;
  const order = unit.order;
  return {
    id: row.id, runId: row.runId, status: row.status, revision: row.revision,
    unit: {
      id: unit.id, unitCode: unit.unitCode, merk: unit.merk, ukuran: unit.ukuran, orderNumber: order?.orderNumber ?? null,
      service: unit.service ? { code: unit.service.code, label: unit.service.labelId } : null, photoUrl,
    },
    customer: { name: order?.customer?.name ?? null, city: order?.customer?.city ?? null, salesName: order?.customer?.assignedSales?.name ?? null },
    workCenter: row.workCenter, operator: row.operator ? { ...row.operator, name: row.operator.user?.name ?? null } : null,
    cornerWorkCenter: row.cornerWorkCenter, cornerOperator: row.cornerOperator ? { ...row.cornerOperator, name: row.cornerOperator.user?.name ?? null } : null,
    productionDate: row.productionDate, stationCode: row.stationCode, priority: row.priority,
    targetStartAt: row.targetStartAt, targetCompleteAt: row.targetCompleteAt,
    plannedAt: row.plannedAt, materialReservedAt: row.materialReservedAt, cancelledAt: row.cancelledAt, cancelReason: row.cancelReason,
    bomLines: row.bomLines.map((l) => ({ id: l.id, materialId: l.materialId, code: l.material.code, name: l.material.name, qty: Number(l.qty), unit: l.unit })),
    reservations: row.reservations.map((r) => ({ id: r.id, materialId: r.materialId, qty: Number(r.qty), reservedAt: r.reservedAt })),
    updatedAt: row.updatedAt,
  };
}
