// Command owner Production Experience V2 (P8): bukti 12 tahap PIC Table/Corner dan "Menunggu Bahan Baku".
// SATU-SATUNYA penulis production_step_evidence_v2 dan production_material_shortages_v2 (lihat
// scripts/production-delivery-v2/audit-production-experience-writers.js).
//
// Kontrak:
//  - BUKAN state paralel: transisi tahap tetap engine P5 (prepareStartInTx/applyStartInTx/applyCompleteInTx/applyPauseInTx/applyResumeInTx)
//    di TRANSAKSI YANG SAMA dengan bukti. File ini tidak menulis production_operation_runs_v2/production_runs_v2/fase secara langsung.
//  - Urutan tahap diturunkan dari keadaan run (operasi aktif, tahap berikutnya, bukti, QC, kekurangan bahan) oleh deriveNextAction (murni).
//    Tahap yang diminta harus sama dengan tahap berikutnya — tidak ada tahap yang bisa dilewati (409 STEP_OUT_OF_ORDER).
//  - Setiap command: Idempotency-Key (v2_commands, replay mengembalikan respons yang sama), expectedRevision run (409 bila basi),
//    bukti wajib sesuai kontrak (validateStepEvidence), outbox + audit aktivitas — commit/batal bersama.
//  - Bukti IMMUTABLE (trigger database): pengulangan/rework menambah versi baru, histori tidak pernah diubah.
//  - Tidak menulis stok/reservasi/HPP/jurnal: bahan di tahap 6/7/10 hanya DICOCOKKAN dengan bahan yang sudah diserahkan Gudang (P4).
//  - Uji tekstur PIC (tahap 8) BUKAN QC: PAS hanya menyelesaikan modul terakhir -> AWAITING_QC; QC resmi tetap P6 (QC_WRITE).
//  - Tahap 12 menyelesaikan tahap `finished` -> penawaran barang jadi P6 (bukan READY_FOR_DELIVERY) + event laporan `production.report.ready`
//    di outbox berstatus PENDING (belum ada consumer broadcast; tidak pernah ditandai terkirim di sini).
//  - Writer di balik production_v2_writer (cohort unitIds, fail-closed); unit non-cohort tidak pernah mendapat bukti/kekurangan V2.
import { createHash, randomUUID } from "node:crypto";
import { recordActivity, EVENT_TYPES } from "../lib/activityLog.js";
import {
  STEP_BY_NO, deriveNextAction, stepNoForStage, validateStepEvidence,
} from "../lib/domain/productionSteps.js";
import { assertNoOpenRunException } from "./productionRunGuards.js";
import {
  RUN_INCLUDE, activeOperation, applyCompleteInTx, applyPauseInTx, applyResumeInTx, applyStartInTx, authorizeOperator,
  bumpRunRevisionInTx, isPostQcStage, loadMaterialFacts, loadRunForWrite, materialReadiness, peekStartIsPostQc, prepareStartInTx, workshopPathOf,
} from "./productionWorkshopExecutionCommandService.js";
import { pathForUnit, resolveCurrentTarget } from "./unitStageEngine.js";
import { lockRowForUpdate } from "./inventoryLedger.js";
import { evidenceFileExists } from "../lib/productionEvidenceStore.js";
import { isProductionWriterEnabledFor, loadV2Flags, resolveProductionWriterState } from "./v2FeatureFlags.js";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{12,128}$/;
const TERMINAL_RUN = ["COMPLETED", "CANCELLED"];

function stepError(message, statusCode, code, details) {
  return Object.assign(new Error(message), { statusCode, code, ...(details ? { details } : {}) });
}
const hash = (value) => createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");

export function assertIdempotencyKey(key) {
  if (!key || !IDEMPOTENCY_KEY.test(key)) throw stepError("Idempotency-Key wajib diisi (12-128 karakter)", 400, "IDEMPOTENCY_KEY_INVALID");
}
export function assertExpectedRevision(value) {
  const revision = Number(value);
  if (value == null || value === "" || !Number.isInteger(revision) || revision < 1) {
    throw stepError("expectedRevision wajib diisi (angka bulat positif)", 400, "EXPECTED_REVISION_REQUIRED");
  }
  return revision;
}
function assertRunRevision(run, expected) {
  if (run.revision !== expected) {
    throw stepError(`Data unit sudah berubah (revisi ${run.revision}, Anda memakai ${expected}). Muat ulang kartu lalu ulangi.`, 409, "STEP_REVISION_CONFLICT", { revision: run.revision });
  }
}

async function beginCommand(tx, { actor, idempotencyKey, commandType, aggregateType = "ProductionRun", aggregateId, requestHash, expectedRevision = null }) {
  return tx.v2Command.create({ data: { domain: "PRODUCTION", actorId: actor, idempotencyKey, commandType, aggregateType, aggregateId, expectedRevision, requestHash } });
}
async function finishCommand(tx, command, appliedRevision, response) {
  await tx.v2Command.update({ where: { id: command.id }, data: { status: "APPLIED", appliedRevision, response, completedAt: new Date() } });
}
async function findReplay(tx, actor, idempotencyKey, requestHash) {
  const replay = await tx.v2Command.findUnique({ where: { actorId_idempotencyKey: { actorId: actor, idempotencyKey } } });
  if (!replay) return null;
  if (replay.requestHash !== requestHash) throw stepError("Idempotency-Key dipakai untuk isian berbeda", 409, "IDEMPOTENCY_CONFLICT");
  if (replay.status !== "APPLIED") throw stepError("Perintah sebelumnya masih diproses", 409, "COMMAND_IN_PROGRESS");
  return { replayed: true, ...replay.response };
}
async function outbox(tx, { eventType, aggregateType = "ProductionRun", aggregateId, revision, dedupeKey, payload }) {
  return tx.domainOutbox.create({ data: { domain: "PRODUCTION", eventType, aggregateType, aggregateId, aggregateRevision: revision, dedupeKey, payload } });
}
async function assertWriterEnabledForUnit(tx, unitId) {
  const state = resolveProductionWriterState(await loadV2Flags(tx));
  if (!isProductionWriterEnabledFor(state, unitId)) throw stepError("Produksi V2 tidak aktif untuk unit ini; gunakan alur lama", 503, "STEP_WRITER_OFF");
}

// ---------------------------------------------------------------------------
// Keadaan tahap (dipakai command DAN read-model). `client` = tx atau prisma.
// ---------------------------------------------------------------------------
export async function loadStepContext(client, run) {
  let path = null;
  let pathError = null;
  let split = null;
  try {
    path = await pathForUnit(client, run.unit);
    split = workshopPathOf(path);
  } catch (error) { pathError = error.message; }
  const stageById = new Map((path || []).map((s) => [s.id, s]));
  const op = activeOperation(run);
  const [evidence, openShortage, latestInspection, exception, materialFacts] = await Promise.all([
    client.productionStepEvidence.findMany({ where: { runId: run.id }, orderBy: [{ createdAt: "asc" }, { stepNo: "asc" }, { version: "asc" }] }),
    client.productionMaterialShortage.findFirst({ where: { runId: run.id, status: "OPEN" } }),
    client.qualityInspection.findFirst({ where: { runId: run.id }, orderBy: { version: "desc" }, select: { id: true, version: true, result: true, inspectedAt: true, createdAt: true } }),
    client.productionRunException.findFirst({ where: { runId: run.id, status: "OPEN" }, select: { id: true } }),
    run.plan ? loadMaterialFacts(client, run.plan) : null,
  ]);
  const material = run.plan ? materialReadiness({ plan: run.plan, ...materialFacts }) : { ready: false, reason: "Belum ada rencana" };
  let target = null;
  if (!op && path && split && !TERMINAL_RUN.includes(run.status)) {
    const { stage } = await resolveCurrentTarget(client, run.unit, path);
    if (stage) target = { id: stage.id, code: stage.code, phase: stage.phase, sequence: stage.sequence, requiresQc: !!stage.requiresQc, isPostQc: split.postQcStages.some((s) => s.id === stage.id), label: stage.labelId };
  }
  const opStage = op ? stageById.get(op.stageId) : null;
  const lastPreQc = split?.stages.at(-1) ?? null;
  const qcAt = latestInspection ? new Date(latestInspection.inspectedAt || latestInspection.createdAt).getTime() : null;
  const step9SinceQc = qcAt != null && evidence.some((e) => e.stepNo === 9 && new Date(e.createdAt).getTime() >= qcAt);
  const ordered = evidence.map((e, index) => ({ ...e, order: index }));
  const state = {
    runStatus: run.status, currentPhase: run.currentPhase, unitStatus: run.unit.status,
    handoffPhaseStatus: run.phases.find((p) => p.phase === "HANDOFF")?.status ?? null,
    exceptionOpen: !!exception,
    activeOp: op ? {
      id: op.id, stageId: op.stageId, stageCode: op.stageCode, stageLabel: op.stageLabel, status: op.status,
      stagePhase: opStage?.phase ?? null, stageSequence: opStage?.sequence ?? null,
      isLastPreQc: !!lastPreQc && lastPreQc.id === op.stageId, isPostQc: !!split?.postQcStages.some((s) => s.id === op.stageId),
      startedAt: op.startedAt,
    } : null,
    target,
    opEvidence: op ? ordered.filter((e) => e.operationRunId === op.id) : [],
    step9SinceQc,
    openShortage: !!openShortage,
    serviceSet: !!run.unit.serviceId,
    pathHasModules: !!split?.stages.some((s) => s.phase === "MODULE"),
    materialReady: material.ready,
  };
  return { path, split, pathError, evidence: ordered, openShortage, latestInspection, material, state, next: deriveNextAction(state) };
}

// Nomor tahap yang berlaku untuk jalur unit (untuk "x dari 12"): tahap 6/7 hanya bila jalurnya punya modul terkait.
export function applicableStepsFor(split) {
  const steps = new Set([1, 2, 3, 4, 5, 8, 9, 10, 11, 12]);
  for (const stage of split?.stages || []) {
    const n = stepNoForStage(stage);
    if (n === 6 || n === 7) steps.add(n);
  }
  if (!split?.stages.some((s) => s.phase === "MODULE")) { steps.add(6); steps.add(7); } // layanan belum ditetapkan: tampilkan lengkap
  return [...steps].sort((a, b) => a - b);
}

// Bahan yang sudah DISERAHKAN Gudang untuk rencana ini (issue ISSUED), per material.
async function issuedQtyByMaterial(tx, planId) {
  if (!planId) return new Map();
  const lines = await tx.materialIssueLine.findMany({ where: { materialIssue: { productionPlanId: planId, status: "ISSUED" } }, select: { materialId: true, issuedQty: true } });
  const map = new Map();
  for (const line of lines) map.set(line.materialId, (map.get(line.materialId) || 0) + Number(line.issuedQty || 0));
  return map;
}

async function writeEvidence(tx, { run, stepNo, operationRunId, stageId, payload, media, actorId, commandId }) {
  const version = (await tx.productionStepEvidence.count({ where: { runId: run.id, stepNo } })) + 1;
  const step = STEP_BY_NO[stepNo];
  return tx.productionStepEvidence.create({
    data: { id: randomUUID(), runId: run.id, operationRunId: operationRunId || null, stageId: stageId || null, stepNo, stepCode: step.code, version, payload, media, actorId: actorId || null, commandId },
  });
}

// Mulai tahap berikutnya pra-QC secara otomatis setelah tahap selesai (timer berjalan). Validasi read-only; bila ditolak (mis. bahan belum
// diserahkan, layanan belum ditetapkan) tidak ada yang ditulis dan kartu menampilkan status tunggu. Kesalahan penerapan TIDAK ditelan.
async function tryAutoStartNext(tx, runId, actorId) {
  const run = await loadRunForWrite(tx, runId);
  if (activeOperation(run) || run.currentPhase !== "PROCESS") return null;
  let prepared;
  try {
    prepared = await prepareStartInTx(tx, run);
  } catch (error) {
    if (error?.statusCode === 409) return null;
    throw error;
  }
  if (prepared.isPostQc) return null;
  return applyStartInTx(tx, { run, prepared, actorId });
}

function waitMessage(next) {
  switch (next.wait) {
    case "AWAITING_QC": return "Unit sedang menunggu QC oleh petugas QC.";
    case "MATERIAL_NOT_READY": return "Bahan dari Gudang belum diserahkan untuk tahap ini.";
    case "MATERIAL_SHORTAGE": return "Unit menunggu bahan baku dari Gudang.";
    case "SERVICE_NOT_SET": return "Diagnosa sudah dikirim. Layanan unit belum ditetapkan Production Lead.";
    case "AWAITING_WAREHOUSE": return "Barang jadi menunggu diterima Gudang.";
    case "HANDOFF_REJECTED": return "Barang jadi ditolak Gudang — tindak lanjut lewat Production Lead.";
    case "EXCEPTION_OPEN": return "Ada konflik data yang harus diselesaikan Production Lead lebih dulu.";
    case "COMPLETED": return "Produksi unit ini sudah selesai.";
    default: return "Tahap ini belum bisa dikerjakan sekarang.";
  }
}

// ---------------------------------------------------------------------------
// Command: catat/jalankan tahap. body: { expectedRevision, workCenterId, payload, media }
// ---------------------------------------------------------------------------
export async function recordProductionStep(prisma, { runId, stepNo, actorId, idempotencyKey, expectedRevision, workCenterId, payload = {}, media = [] }) {
  if (!runId) throw stepError("runId wajib diisi", 400, "STEP_RUN_REQUIRED");
  const requestedStep = Number(stepNo);
  if (!STEP_BY_NO[requestedStep]) throw stepError("Tahap tidak dikenal", 400, "STEP_UNKNOWN");
  assertIdempotencyKey(idempotencyKey);
  const revisionExpected = assertExpectedRevision(expectedRevision);
  const actor = actorId || "SYSTEM";
  const requestHash = hash({ commandType: "RECORD_PRODUCTION_STEP", runId, stepNo: requestedStep, expectedRevision: revisionExpected, workCenterId: workCenterId || null, payload, media });

  return prisma.$transaction(async (tx) => {
    const run = await loadRunForWrite(tx, runId);
    const replay = await findReplay(tx, actor, idempotencyKey, requestHash);
    if (replay) return replay;
    await assertWriterEnabledForUnit(tx, run.unitId);
    const ctx = await loadStepContext(tx, run);
    const next = ctx.next;
    if (next.action === "WAIT") {
      // Diagnosa terkirim + layanan belum ditetapkan: tahap 5 boleh "Lanjutkan" setelah layanan diisi — sebelum itu tetap menunggu.
      throw stepError(waitMessage(next), 409, `STEP_WAITING_${next.wait}`, { expectedStep: next.stepNo, waitingFor: next.actor });
    }
    if (next.stepNo !== requestedStep) {
      throw stepError(`Tahap ${requestedStep} belum/tidak bisa dikerjakan. Tahap berikutnya: ${next.stepNo} (${STEP_BY_NO[next.stepNo]?.label || "—"}).`, 409, "STEP_OUT_OF_ORDER", { expectedStep: next.stepNo, action: next.action });
    }
    await authorizeOperator(tx, run, actorId, workCenterId, { postQc: next.actor === "CORNER" });
    assertRunRevision(run, revisionExpected);
    await assertNoOpenRunException(tx, run.id);

    const command = await beginCommand(tx, { actor, idempotencyKey, commandType: "RECORD_PRODUCTION_STEP", aggregateId: runId, requestHash, expectedRevision: revisionExpected });
    const now = new Date();
    const evidenceCtx = { issuedQtyByMaterial: [6, 7, 10].includes(requestedStep) ? await issuedQtyByMaterial(tx, run.plan?.id) : new Map() };
    let evidence = null;
    let transition = null;
    let autoStarted = null;
    let revision = run.revision;

    const record = async (operationRunId, stageId, validated) => {
      const missing = validated.media.filter((m) => !evidenceFileExists(m.url));
      if (missing.length) throw stepError("Ada media bukti yang belum selesai terunggah — unggah ulang lalu kirim lagi", 422, "STEP_MEDIA_NOT_FOUND", { count: missing.length });
      evidence = await writeEvidence(tx, { run, stepNo: requestedStep, operationRunId, stageId, payload: validated.payload, media: validated.media, actorId, commandId: command.id });
    };

    switch (next.action) {
      case "START_WITH_EVIDENCE": { // tahap 1
        const validated = validateStepEvidence(requestedStep, { payload, media }, evidenceCtx);
        const prepared = await prepareStartInTx(tx, run);
        transition = await applyStartInTx(tx, { run, prepared, actorId, now });
        revision = transition.revision;
        await record(transition.operationRunId, prepared.stage.id, validated);
        break;
      }
      case "START": { // mulai ulang/tertunda (tanpa bukti baru; bukti menyusul di tahap ini)
        const prepared = await prepareStartInTx(tx, run);
        transition = await applyStartInTx(tx, { run, prepared, actorId, now });
        revision = transition.revision;
        break;
      }
      case "RESUME": {
        if (ctx.openShortage) throw stepError("Bahan baku belum diserahkan Gudang; tahap belum bisa dilanjutkan", 409, "STEP_SHORTAGE_OPEN");
        const op = activeOperation(run);
        transition = await applyResumeInTx(tx, { run, op, actorId });
        revision = transition.revision;
        break;
      }
      case "COMPLETE": { // 2,3,4,5,6/7 bukan modul terakhir, 11
        const op = activeOperation(run);
        const existingDiagnosis = requestedStep === 5 ? ctx.evidence.filter((e) => e.operationRunId === op.id && e.stepNo === 5).at(-1) : null;
        const reuseDiagnosis = requestedStep === 5 && existingDiagnosis && !payload?.diagnosis;
        const validated = reuseDiagnosis ? null : validateStepEvidence(requestedStep, { payload, media }, evidenceCtx);
        if (validated) await record(op.id, op.stageId, validated);
        if (requestedStep === 5 && (!ctx.state.serviceSet || !ctx.state.pathHasModules)) {
          // Diagnosa tercatat; tahap belum ditutup karena jalur modul belum diketahui (menyelesaikannya sekarang akan membawa unit ke QC).
          revision = await bumpRunRevisionInTx(tx, run);
          break;
        }
        transition = await applyCompleteInTx(tx, { run, op, actorId, note: validated?.payload?.note ?? null, photoUrls: (validated?.media || []).map((m) => m.url) });
        revision = transition.revision;
        if (requestedStep <= 7 && !transition.awaitingQc) {
          autoStarted = await tryAutoStartNext(tx, run.id, actorId);
          if (autoStarted) revision = autoStarted.revision;
        }
        break;
      }
      case "EVIDENCE": { // bukti modul terakhir (atau ulang setelah uji tekstur tidak PAS)
        const op = activeOperation(run);
        const validated = validateStepEvidence(requestedStep, { payload, media }, evidenceCtx);
        await record(op.id, op.stageId, validated);
        revision = await bumpRunRevisionInTx(tx, run);
        break;
      }
      case "TEST": { // tahap 8
        const op = activeOperation(run);
        const validated = validateStepEvidence(8, { payload, media }, evidenceCtx);
        await record(op.id, op.stageId, validated);
        if (validated.payload.verdict === "PAS") {
          transition = await applyCompleteInTx(tx, { run, op, actorId, note: `Uji tekstur PIC: PAS${validated.payload.note ? ` — ${validated.payload.note}` : ""}`, photoUrls: validated.media.map((m) => m.url) });
          revision = transition.revision;
        } else {
          revision = await bumpRunRevisionInTx(tx, run);
        }
        break;
      }
      case "HANDOFF": { // tahap 9: tanpa transisi tahap
        const validated = validateStepEvidence(9, { payload, media }, evidenceCtx);
        await record(null, ctx.state.target?.id ?? null, validated);
        revision = await bumpRunRevisionInTx(tx, run);
        break;
      }
      case "START_CORNER": { // tahap 10
        const validated = validateStepEvidence(10, { payload, media }, evidenceCtx);
        const prepared = await prepareStartInTx(tx, run);
        transition = await applyStartInTx(tx, { run, prepared, actorId, now });
        revision = transition.revision;
        await record(transition.operationRunId, prepared.stage.id, validated);
        break;
      }
      case "FINISH": { // tahap 12: mulai + selesai `finished` -> handoff barang jadi P6
        const validated = validateStepEvidence(12, { payload, media }, evidenceCtx);
        const prepared = await prepareStartInTx(tx, run);
        const started = await applyStartInTx(tx, { run, prepared, actorId, now });
        const reloaded = await loadRunForWrite(tx, run.id);
        const op = activeOperation(reloaded);
        transition = await applyCompleteInTx(tx, { run: reloaded, op, actorId, note: validated.payload.note, photoUrls: validated.media.map((m) => m.url) });
        revision = transition.revision;
        await record(started.operationRunId, prepared.stage.id, validated);
        break;
      }
      default:
        throw stepError("Aksi tahap tidak dikenal", 409, "STEP_ACTION_UNKNOWN");
    }

    const step = STEP_BY_NO[requestedStep];
    if (evidence) {
      await outbox(tx, {
        eventType: "production.step.recorded", aggregateId: run.id, revision, dedupeKey: `production-step-recorded:${run.id}:${requestedStep}:${evidence.version}`,
        payload: { runId: run.id, unitId: run.unitId, stepNo: requestedStep, stepCode: step.code, version: evidence.version, evidenceId: evidence.id, action: next.action, verdict: evidence.payload?.verdict ?? null, revision, occurredAt: now.toISOString(), actorId },
      });
      await recordActivity(tx, {
        entityType: "unit", entityId: run.unitId, eventType: EVENT_TYPES.PRODUCTION_STEP_RECORDED, actorId: actorId || null,
        metadata: { unitCode: run.unit.unitCode, runId: run.id, stepNo: requestedStep, stepLabel: step.label, version: evidence.version, verdict: evidence.payload?.verdict ?? null, mediaCount: (evidence.media || []).length },
      });
    }
    if (requestedStep === 12 && transition?.handoffReady) {
      await outbox(tx, {
        eventType: "production.report.ready", aggregateId: run.id, revision, dedupeKey: `production-report-ready:${run.id}:${transition.handoffId}`,
        payload: {
          runId: run.id, unitId: run.unitId, orderId: run.unit.orderId, handoffId: transition.handoffId, reportPath: `/bengkel/production-v2/laporan/${run.id}`,
          audiences: ["SALES_GROUP", "SALES_PIC"], deliveryStatus: "PENDING_CONSUMER", occurredAt: now.toISOString(), actorId,
        },
      });
    }

    const after = await loadRunForWrite(tx, run.id);
    const afterCtx = await loadStepContext(tx, after);
    const response = {
      runId: run.id, revision: after.revision, stepNo: requestedStep, action: next.action,
      ...(evidence ? { evidenceId: evidence.id, version: evidence.version } : {}),
      ...(transition?.awaitingQc ? { awaitingQc: true } : {}),
      ...(transition?.handoffId ? { handoffId: transition.handoffId } : {}),
      ...(autoStarted ? { autoStarted: { stage: autoStarted.stage } } : {}),
      verdict: evidence?.payload?.verdict ?? null,
      next: afterCtx.next,
    };
    await finishCommand(tx, command, after.revision, response);
    return { replayed: false, ...response };
  }, { timeout: 20_000 });
}

// ---------------------------------------------------------------------------
// "Menunggu Bahan Baku": catat bahan kurang; operasi aktif dijeda SAH lewat P5 (PROCESS_DELAY + catatan). Satu OPEN per run.
// ---------------------------------------------------------------------------
function normalizeShortageItems(items) {
  if (!Array.isArray(items) || items.length === 0) throw stepError("Pilih minimal satu bahan yang kurang", 400, "SHORTAGE_ITEMS_REQUIRED");
  if (items.length > 20) throw stepError("Maksimal 20 bahan per laporan", 400, "SHORTAGE_ITEMS_TOO_MANY");
  const seen = new Set();
  return items.map((item) => {
    const materialId = item?.materialId;
    if (!materialId || typeof materialId !== "string") throw stepError("Bahan tidak valid", 400, "SHORTAGE_ITEM_INVALID");
    if (seen.has(materialId)) throw stepError("Bahan yang sama dipilih dua kali", 400, "SHORTAGE_ITEM_DUPLICATE");
    seen.add(materialId);
    const qty = item.qty == null || item.qty === "" ? null : Number(item.qty);
    if (qty != null && (!Number.isFinite(qty) || qty <= 0)) throw stepError("Jumlah bahan harus lebih dari 0", 400, "SHORTAGE_ITEM_QTY_INVALID");
    const note = typeof item.note === "string" ? item.note.trim().slice(0, 300) || null : null;
    return { materialId, qty, note };
  });
}

export async function reportMaterialShortage(prisma, { runId, actorId, idempotencyKey, expectedRevision, workCenterId, items, note = null }) {
  assertIdempotencyKey(idempotencyKey);
  const revisionExpected = assertExpectedRevision(expectedRevision);
  const normalized = normalizeShortageItems(items);
  const cleanNote = typeof note === "string" ? note.trim().slice(0, 500) || null : null;
  const actor = actorId || "SYSTEM";
  const requestHash = hash({ commandType: "REPORT_MATERIAL_SHORTAGE", runId, expectedRevision: revisionExpected, workCenterId: workCenterId || null, items: normalized, note: cleanNote });

  return prisma.$transaction(async (tx) => {
    const run = await loadRunForWrite(tx, runId);
    const replay = await findReplay(tx, actor, idempotencyKey, requestHash);
    if (replay) return replay;
    await assertWriterEnabledForUnit(tx, run.unitId);
    if (TERMINAL_RUN.includes(run.status)) throw stepError("Produksi unit ini sudah selesai/dibatalkan", 409, "SHORTAGE_RUN_TERMINAL");
    const op = activeOperation(run);
    const postQc = op ? await isPostQcStage(tx, run, op.stageId) : await peekStartIsPostQc(tx, run);
    await authorizeOperator(tx, run, actorId, workCenterId, { postQc });
    assertRunRevision(run, revisionExpected);
    await assertNoOpenRunException(tx, run.id);
    if (run.currentPhase === "HANDOFF") throw stepError("Unit sudah diserahkan ke Gudang", 409, "SHORTAGE_RUN_IN_HANDOFF");
    const open = await tx.productionMaterialShortage.findFirst({ where: { runId, status: "OPEN" }, select: { id: true } });
    if (open) throw stepError("Laporan menunggu bahan untuk unit ini masih terbuka", 409, "SHORTAGE_ALREADY_OPEN", { shortageId: open.id });
    const materials = await tx.material.findMany({ where: { id: { in: normalized.map((i) => i.materialId) } }, select: { id: true, code: true, name: true, unit: true } });
    if (materials.length !== normalized.length) throw stepError("Ada bahan yang tidak dikenal", 422, "SHORTAGE_ITEM_UNKNOWN");
    const byId = new Map(materials.map((m) => [m.id, m]));

    const command = await beginCommand(tx, { actor, idempotencyKey, commandType: "REPORT_MATERIAL_SHORTAGE", aggregateId: runId, requestHash, expectedRevision: revisionExpected });
    const now = new Date();
    const itemLabel = normalized.map((i) => byId.get(i.materialId).name).join(", ");
    let revision;
    let paused = false;
    if (op && op.status === "ACTIVE") {
      const result = await applyPauseInTx(tx, { run, op, actorId, reason: "PROCESS_DELAY", note: `Menunggu bahan baku: ${itemLabel}${cleanNote ? ` — ${cleanNote}` : ""}` });
      revision = result.revision;
      paused = true;
    } else {
      revision = await bumpRunRevisionInTx(tx, run);
    }
    const shortage = await tx.productionMaterialShortage.create({
      data: {
        id: randomUUID(), runId, unitId: run.unitId, operationRunId: op?.id ?? null, status: "OPEN", revision: 1,
        items: normalized.map((i) => ({ ...i, code: byId.get(i.materialId).code, name: byId.get(i.materialId).name, uom: byId.get(i.materialId).unit ?? null })),
        note: cleanNote, reportedById: actorId || null, reportedAt: now, commandId: command.id,
      },
    });
    await outbox(tx, {
      eventType: "production.material.shortage_reported", aggregateId: run.id, revision, dedupeKey: `production-material-shortage:${shortage.id}:1`,
      payload: { runId, unitId: run.unitId, shortageId: shortage.id, items: shortage.items, paused, revision, occurredAt: now.toISOString(), actorId },
    });
    await recordActivity(tx, {
      entityType: "unit", entityId: run.unitId, eventType: EVENT_TYPES.PRODUCTION_MATERIAL_SHORTAGE_REPORTED, actorId: actorId || null,
      metadata: { unitCode: run.unit.unitCode, runId, shortageId: shortage.id, itemCount: normalized.length, note: cleanNote },
    });
    const response = { runId, revision, shortageId: shortage.id, status: "OPEN", paused };
    await finishCommand(tx, command, revision, response);
    return { replayed: false, ...response };
  });
}

// Gudang menandai bahan sudah diserahkan (RESOLVED) — tidak menulis stok di sini (serah bahan resmi lewat Material Issue P4).
export async function resolveMaterialShortage(prisma, { shortageId, actorId, idempotencyKey, expectedRevision, note = null }) {
  assertIdempotencyKey(idempotencyKey);
  const revisionExpected = assertExpectedRevision(expectedRevision);
  const cleanNote = typeof note === "string" ? note.trim().slice(0, 500) || null : null;
  const actor = actorId || "SYSTEM";
  const requestHash = hash({ commandType: "RESOLVE_MATERIAL_SHORTAGE", shortageId, expectedRevision: revisionExpected, note: cleanNote });

  return prisma.$transaction(async (tx) => {
    await lockRowForUpdate(tx, "production_material_shortages_v2", shortageId);
    const replay = await findReplay(tx, actor, idempotencyKey, requestHash);
    if (replay) return replay;
    const shortage = await tx.productionMaterialShortage.findUnique({ where: { id: shortageId }, include: { unit: { select: { unitCode: true } } } });
    if (!shortage) throw stepError("Laporan menunggu bahan tidak ditemukan", 404, "SHORTAGE_NOT_FOUND");
    await assertWriterEnabledForUnit(tx, shortage.unitId);
    if (shortage.status !== "OPEN") throw stepError("Laporan ini sudah diselesaikan", 409, "SHORTAGE_NOT_OPEN", { status: shortage.status });
    if (shortage.revision !== revisionExpected) throw stepError("Laporan sudah berubah; muat ulang", 409, "SHORTAGE_REVISION_CONFLICT", { revision: shortage.revision });
    const command = await beginCommand(tx, { actor, idempotencyKey, commandType: "RESOLVE_MATERIAL_SHORTAGE", aggregateType: "ProductionMaterialShortage", aggregateId: shortageId, requestHash, expectedRevision: revisionExpected });
    const now = new Date();
    const revision = shortage.revision + 1;
    await tx.productionMaterialShortage.update({ where: { id: shortageId }, data: { status: "RESOLVED", revision, resolvedById: actorId || null, resolvedAt: now, resolutionNote: cleanNote, commandId: command.id } });
    await outbox(tx, {
      eventType: "production.material.shortage_resolved", aggregateType: "ProductionMaterialShortage", aggregateId: shortageId, revision,
      dedupeKey: `production-material-shortage:${shortageId}:${revision}`,
      payload: { shortageId, runId: shortage.runId, unitId: shortage.unitId, revision, occurredAt: now.toISOString(), actorId },
    });
    await recordActivity(tx, {
      entityType: "unit", entityId: shortage.unitId, eventType: EVENT_TYPES.PRODUCTION_MATERIAL_SHORTAGE_RESOLVED, actorId: actorId || null,
      metadata: { unitCode: shortage.unit.unitCode, shortageId, note: cleanNote },
    });
    const response = { shortageId, status: "RESOLVED", revision };
    await finishCommand(tx, command, revision, response);
    return { replayed: false, ...response };
  });
}

export { RUN_INCLUDE };
