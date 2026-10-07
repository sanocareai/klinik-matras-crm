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
  SKIP_REASON, STEP_BY_NO, deriveNextAction, isSkippedEvidence, skippedEvidencePayload, stepNoForStage, stepsCoveredByStage, validateStepEvidence,
} from "../lib/domain/productionSteps.js";
import { assertNoOpenRunException } from "./productionRunGuards.js";
import {
  RUN_INCLUDE, activeOperation, applyAdaptationFinishInTx, applyAdaptationPolicyInTx, applyCompleteInTx, applyDelayInTx, applyPauseInTx, applyResumeInTx, applySkipStageInTx, applyStartInTx,
  applyQcNotPerformedInTx, assertAdaptationRun, authorizeOperator, bumpRunRevisionInTx, finishBlockersOf, isAdaptationRun, isPostQcStage, loadMaterialFacts, loadRunForWrite, materialReadiness, peekStartIsPostQc,
  prepareSkipInTx, prepareStartInTx, workshopPathOf,
} from "./productionWorkshopExecutionCommandService.js";
import { ADAPTATION_POLICY } from "./productionSettingsService.js";
import { pathForUnit, resolveCurrentTarget } from "./unitStageEngine.js";
import { lockRowForUpdate } from "./inventoryLedger.js";
import { evidenceFileExists } from "../lib/productionEvidenceStore.js";
import { isProductionWriterEnabledFor, loadV2Flags, resolveProductionWriterState } from "./v2FeatureFlags.js";
import { isDocumentationRow, DOC_STEP_CODE_PREFIX } from "../lib/domain/productionDocumentation.js";
import { computeRunLeftovers, createLeftoverReturnsInTx } from "./productionMaterialReturnService.js";
import { allManualMaterialsMapped, diagnosisBomValid } from "./productionDiagnosisCommandService.js";
import { buildApplicableSteps, classifyProduct, pathHasBuildStage } from "../lib/domain/productionBuildTrack.js";
import { loadPreTeardownFacts } from "./productionComponentNoteService.js";

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
  const [allEvidence, openShortage, latestInspection, exception, materialFacts, diagnosisManualMapped, diagnosisBomHasLines] = await Promise.all([
    client.productionStepEvidence.findMany({ where: { runId: run.id }, orderBy: [{ createdAt: "asc" }, { stepNo: "asc" }, { version: "asc" }] }),
    client.productionMaterialShortage.findFirst({ where: { runId: run.id, status: "OPEN" } }),
    client.qualityInspection.findFirst({ where: { runId: run.id }, orderBy: { version: "desc" }, select: { id: true, version: true, result: true, inspectedAt: true, createdAt: true } }),
    client.productionRunException.findFirst({ where: { runId: run.id, status: "OPEN" }, select: { id: true } }),
    run.plan ? loadMaterialFacts(client, run.plan) : null,
    // P9D — gerbang tahap 5 (lihat state.diagnosisManualMapped/diagnosisBomHasLines di bawah + deriveNextAction).
    allManualMaterialsMapped(client, run.id),
    diagnosisBomValid(client, run.id, run.plan?.id),
  ]);
  // P10B: baris DOKUMENTASI (stepCode DOC_*) hidup di tabel yang sama tetapi TIDAK PERNAH ikut lifecycle — dipisah di satu tempat ini.
  const evidence = allEvidence.filter((e) => !isDocumentationRow(e));
  const documentation = allEvidence.filter((e) => isDocumentationRow(e));
  const material = run.plan ? materialReadiness({ plan: run.plan, ...materialFacts }) : { ready: false, reason: "Belum ada rencana" };
  let target = null;
  if (!op && path && split && !TERMINAL_RUN.includes(run.status)) {
    const { stage, state: targetState } = await resolveCurrentTarget(client, run.unit, path);
    if (stage) target = { done: targetState === "DONE", id: stage.id, code: stage.code, phase: stage.phase, sequence: stage.sequence, requiresQc: !!stage.requiresQc, isPostQc: split.postQcStages.some((s) => s.id === stage.id), label: stage.labelId };
  }
  const opStage = op ? stageById.get(op.stageId) : null;
  const lastPreQc = split?.stages.at(-1) ?? null;
  const qcAt = latestInspection ? new Date(latestInspection.inspectedAt || latestInspection.createdAt).getTime() : null;
  // Mode adaptasi: tidak ada inspeksi QC; tahap 9 tercatat = serah ke Corner sudah dilakukan.
  const step9SinceQc = isAdaptationRun(run) ? evidence.some((e) => e.stepNo === 9 && !isSkippedEvidence(e)) : qcAt != null && evidence.some((e) => e.stepNo === 9 && new Date(e.createdAt).getTime() >= qcAt);
  const ordered = evidence.map((e, index) => ({ ...e, order: index }));
  // Jalur pengerjaan: alur produk (KASUR / NON_KASUR / UNCONFIRMED) dari klasifikasi KANONIS pesanan (lini + jenis produk), bukan nama/awalan resi. Jenis belum jelas = UNCONFIRMED
  // (uji/racikan khusus kasur ditahan + kebutuhan konfirmasi ditampilkan); TIDAK ada fallback ke alur kasur. Plus pengaturan Run (PIC Bahan, kebutuhan Corner) dan catatan racikan/pemakaian terbaru.
  const buildTrack = pathHasBuildStage(split?.stages);
  const product = buildTrack
    ? classifyProduct((await client.order.findUnique({ where: { id: run.unit.orderId }, select: { productLine: true, productType: true } })) || {})
    : null;
  const [buildSetting, buildRecord] = buildTrack
    ? await Promise.all([
      client.productionRunBuildSetting.findUnique({ where: { runId: run.id }, include: { materialOperator: { select: { id: true, userId: true, active: true, user: { select: { name: true } } } } } }),
      client.productionBuildMaterialRecord.findFirst({ where: { runId: run.id }, orderBy: { version: "desc" } }),
    ])
    : [null, null];
  const cornerLocked = buildTrack ? await cornerDecisionLocked(client, run) : false;
  const buildView = buildTrack ? await toBuildView(client, buildSetting, buildRecord, { cornerLocked }) : null;
  // Fase 2 (LAYANAN): gerbang QC sebelum bongkar / lapisan awal / uji fondasi awal. Hanya jalur restorasi non-adaptasi; fakta dibaca hanya saat Run berada di tahap bongkar (hemat query papan).
  // Hanya kategori LAYANAN (restorasi): SEWA dan jalur pengerjaan (BARU/custom) TIDAK berubah.
  const inIntake = ["pre_teardown_test", "teardown", "foundation_test"].includes(op?.stageCode);
  const isLayanan = !buildTrack && !isAdaptationRun(run) && inIntake
    ? (await client.order.findUnique({ where: { id: run.unit.orderId }, select: { category: true } }))?.category === "LAYANAN" : false;
  const preTeardownGate = isLayanan;
  const gateRefs = preTeardownGate ? await loadPreTeardownFacts(client, { unitId: run.unitId, runId: run.id }) : null;
  const lastStep6 = evidence.filter((e) => e.stepNo === 6 && !isSkippedEvidence(e)).at(-1);
  const hasRacikan = (r) => !!r && ((String(r.fondasi || "").trim().length >= 3) || (String(r.lapisan || "").trim().length >= 3));
  const racikanRecorded = buildTrack && (evidence.some((e) => e.stepNo === 6 && !isSkippedEvidence(e) && hasRacikan(e.payload?.racikan)) || hasRacikan(buildRecord?.racikan));
  const state = {
    runStatus: run.status, currentPhase: run.currentPhase, unitStatus: run.unit.status,
    handoffPhaseStatus: run.phases.find((p) => p.phase === "HANDOFF")?.status ?? null,
    exceptionOpen: !!exception,
    activeOp: op ? {
      id: op.id, stageId: op.stageId, stageCode: op.stageCode, stageLabel: op.stageLabel, status: op.status, delayKind: op.delayKind ?? null, delayNote: op.delayNote ?? null,
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
    buildTrack,
    productFlow: product?.flow ?? null, productClass: product?.productClass ?? null, productProblem: product?.problem ?? null,
    cornerRequired: buildTrack ? (buildSetting?.cornerRequired ?? null) : null, cornerReason: buildSetting?.cornerReason ?? null,
    materialOperatorId: buildSetting?.materialOperatorId ?? null, racikanRecorded, lastStep6Version: lastStep6?.version ?? null,
    materialReady: material.ready,
    diagnosisManualMapped, diagnosisBomHasLines,
    adaptation: isAdaptationRun(run), // slice 2: QC tidak wajib -> tahap kerja tuntas = siap "Selesaikan Produksi"
    preTeardownGate, gateRefs,
    qcBeforeRecorded: !!gateRefs?.wholeTest, layersBeforeRecorded: !!gateRefs?.layers, foundationTestRecorded: !!gateRefs?.foundationTest,
  };
  return { path, split, pathError, evidence: ordered, documentation, openShortage, latestInspection, material, state, buildSetting, buildRecord, buildView, next: deriveNextAction(state) };
}

// Nomor tahap yang berlaku untuk jalur unit (untuk "x dari 12"): tahap 6/7 hanya bila jalurnya punya modul terkait.
export function applicableStepsFor(split, productFlow = "KASUR") {
  // Jalur pengerjaan (pesanan BARU): bongkar, pencatatan komponen lama, uji fondasi lama, dan diagnosa kerusakan TIDAK BERLAKU (status NA di tampilan, bukan dikerjakan).
  // Produk non-kasur (divan/sofa): uji tekstur kasur (tahap 8) juga tidak berlaku. Corner tidak diperlukan (dikonfirmasi pada rencana) = jalur tanpa tahap Jahit Corner -> tahap 9–11 tidak berlaku.
  if (pathHasBuildStage(split?.stages)) return buildApplicableSteps(productFlow, { corner: (split?.postQcStages || []).some((st) => st.code === "corner_sewing") });
  const steps = new Set([1, 2, 3, 4, 5, 8, 9, 10, 11, 12]);
  for (const stage of split?.stages || []) {
    const n = stepNoForStage(stage);
    if (n === 6 || n === 7) steps.add(n);
  }
  if (!split?.stages.some((s) => s.phase === "MODULE")) { steps.add(6); steps.add(7); } // layanan belum ditetapkan: tampilkan lengkap
  return [...steps].sort((a, b) => a - b);
}

// Keputusan Corner terkunci setelah unit melewati gerbang QC / masuk tahap Jahit Corner atau Finish (jalur sesudah gerbang sudah ditentukan). Satu sumber: command Corner + tampilan.
let LATE_STAGE_IDS = null;
export async function cornerDecisionLocked(client, run) {
  if (run.currentPhase === "HANDOFF" || ["COMPLETED", "CANCELLED"].includes(run.status)) return true;
  LATE_STAGE_IDS ||= (await client.routingStage.findMany({ where: { code: { in: ["corner_sewing", "finished"] } }, select: { id: true } })).map((st) => st.id);
  const currentStageId = run.unit?.currentStageId ?? (await client.unit.findUnique({ where: { id: run.unitId }, select: { currentStageId: true } }))?.currentStageId ?? null;
  if (currentStageId && LATE_STAGE_IDS.includes(currentStageId)) return true;
  return LATE_STAGE_IDS.length ? (await client.unitStageLog.count({ where: { unitId: run.unitId, stageId: { in: LATE_STAGE_IDS }, createdAt: { gte: run.createdAt } } })) > 0 : false;
}

// Tampilan pengaturan Run + catatan racikan/pemakaian terbaru (jalur pengerjaan) — nama bahan dilengkapi sekali jalan.
async function toBuildView(client, setting, record, { cornerLocked = false } = {}) {
  const lines = Array.isArray(record?.materials) ? record.materials : [];
  const mats = lines.length ? await client.material.findMany({ where: { id: { in: lines.map((l) => l.materialId) } }, select: { id: true, code: true, name: true, unit: true } }) : [];
  const byId = new Map(mats.map((m) => [m.id, m]));
  return {
    materialOperator: setting?.materialOperator ? { id: setting.materialOperator.id, userId: setting.materialOperator.userId, name: setting.materialOperator.user?.name ?? null, active: setting.materialOperator.active } : null,
    corner: { required: setting?.cornerRequired ?? null, reason: setting?.cornerReason ?? null, confirmed: setting?.cornerRequired != null, locked: cornerLocked },
    record: record ? {
      version: record.version, racikan: record.racikan ?? null, note: record.note ?? null, at: record.createdAt, by: record.actorId ?? null,
      materials: lines.map((l) => ({ materialId: l.materialId, qty: Number(l.qty), code: byId.get(l.materialId)?.code ?? null, name: byId.get(l.materialId)?.name ?? null, uom: byId.get(l.materialId)?.unit ?? null })),
    } : null,
  };
}

// Ringkasan pengerjaan terakhir (bukti tahap 6) untuk pembaca lain (mis. layar QC): racikan + penjelasan. Pembaca bukti tetap SATU pintu di file ini (audit pembaca P10B).
export async function loadBuildSummary(client, runId) {
  const [row, record] = await Promise.all([
    client.productionStepEvidence.findFirst({ where: { runId, stepNo: 6, stepCode: { not: { startsWith: DOC_STEP_CODE_PREFIX } } }, orderBy: { version: "desc" }, select: { payload: true } }),
    client.productionBuildMaterialRecord.findFirst({ where: { runId }, orderBy: { version: "desc" }, select: { racikan: true, note: true } }),
  ]);
  const ev = row && !isSkippedEvidence(row) ? row.payload : null;
  // Racikan: dari bukti PIC Meja bila ada, kalau tidak dari catatan PIC Bahan (versi terbaru).
  return { racikan: ev?.racikan ?? record?.racikan ?? null, note: ev?.note ?? record?.note ?? null };
}

// Bahan yang sudah DISERAHKAN Gudang untuk rencana ini (issue ISSUED), per material.
export async function issuedQtyByMaterial(tx, planId) {
  if (!planId) return new Map();
  const lines = await tx.materialIssueLine.findMany({ where: { materialIssue: { productionPlanId: planId, status: "ISSUED" } }, select: { materialId: true, issuedQty: true } });
  const map = new Map();
  for (const line of lines) map.set(line.materialId, (map.get(line.materialId) || 0) + Number(line.issuedQty || 0));
  return map;
}

async function writeEvidence(tx, { run, stepNo, operationRunId, stageId, payload, media, actorId, commandId }) {
  // versi dihitung dari bukti TAHAP saja (baris dokumentasi DOC_* memakai rentang versi >= 1000 dan tidak boleh menggeser nomor versi tahap)
  const version = (await tx.productionStepEvidence.count({ where: { runId: run.id, stepNo, NOT: { stepCode: { startsWith: DOC_STEP_CODE_PREFIX } } } })) + 1;
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
    case "SERVICE_NOT_SET": return "Diagnosa sudah dikirim. Layanan Sales belum dipetakan ke layanan produksi — Admin perlu memetakannya di Pengaturan Produksi.";
    case "READY_TO_FINISH": return "Tahap kerja selesai. Tekan Selesaikan Produksi (QC tidak diwajibkan pada mode adaptasi).";
    case "DIAGNOSIS_MANUAL_UNMAPPED": return "Diagnosa sudah dikirim. Menunggu Production Lead memetakan bahan manual ke katalog.";
    case "DIAGNOSIS_BOM_EMPTY": return "Diagnosa sudah dikirim. Planned BOM masih kosong — isi bahan katalog lewat Revisi Diagnosis.";
    case "AWAITING_WAREHOUSE": return "Barang jadi menunggu diterima Gudang.";
    case "HANDOFF_REJECTED": return "Barang jadi ditolak Gudang — tindak lanjut lewat Production Lead.";
    case "EXCEPTION_OPEN": return "Ada konflik data yang harus diselesaikan Production Lead lebih dulu.";
    case "QC_BEFORE_PENDING": return "Menunggu PIC QC mencatat uji kasur sebelum bongkar (QC sebelum bongkar).";
    case "FOUNDATION_TEST_PENDING": return "Menunggu PIC QC mencatat uji fondasi awal.";
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
    const evidenceCtx = { preTeardownGate: ctx.state.preTeardownGate, gateRefs: ctx.state.gateRefs, issuedQtyByMaterial: [6, 7, 10].includes(requestedStep) ? await issuedQtyByMaterial(tx, run.plan?.id) : new Map(), buildTrack: ctx.state.buildTrack, productFlow: ctx.state.productFlow, racikanRecorded: ctx.state.racikanRecorded, materialsByPic: !!(ctx.state.materialOperatorId || ctx.buildRecord) };
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
        // P9D — tahap 5 belum boleh ditutup selama: layanan belum ditetapkan (lama, P8), jalur modul belum
        // diketahui (lama, P8), ATAU (BARU) masih ada bahan manual belum dipetakan/Planned BOM belum berisi
        // apa pun (state.diagnosisManualMapped/diagnosisBomHasLines, dihitung di loadStepContext).
        if (requestedStep === 5 && (!ctx.state.serviceSet || !ctx.state.pathHasModules || !ctx.state.diagnosisManualMapped || !ctx.state.diagnosisBomHasLines)) {
          // Diagnosa tercatat; tahap belum ditutup (menyelesaikannya sekarang akan membawa unit ke QC).
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
        // Mode adaptasi: gerbang QC dicatat TIDAK DILAKUKAN (SKIP berkatalog + operasi SKIPPED + aktivitas) di transaksi yang sama; bukan PASS, bukan WAIVED, tanpa inspeksi/custody.
        if (next.qcNotPerformed) {
          await applyQcNotPerformedInTx(tx, { run, actorId, now });
          await recordActivity(tx, { entityType: "unit", entityId: run.unitId, eventType: EVENT_TYPES.PRODUCTION_QC_NOT_PERFORMED, actorId: actorId || null, metadata: { unitCode: run.unit.unitCode, runId: run.id, reason: SKIP_REASON } });
        }
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
    if (requestedStep === 12 && transition?.handoffReady && !isAdaptationRun(run)) {
      // Sisa bahan WAJIB dikembalikan ke Gudang: antrean retur dibuka di transaksi yang sama; barang jadi baru bisa diterima setelah retur diterima.
      await createLeftoverReturnsInTx(tx, { run, actorId, commandId: command.id });
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

// ---------------------------------------------------------------------------
// FLOW ADAPTASI (slice 2). Semua command: Idempotency-Key (v2_commands), expectedRevision, kunci unit->run (loadRunForWrite), writer cohort fail-closed, authorizeOperator
// (PIC yang ditugaskan, atau ADMIN/OWNER lewat PRODUCTION_EXECUTE_ANY), guard konflik/drift. Penulis operasi/fase/run/ledger tahap/unit TETAP helper P5 (apply*InTx);
// file ini hanya menulis bukti (SKIPPED), retur sisa bahan (lewat service retur), outbox, dan audit.
// ---------------------------------------------------------------------------
export const DELAY_KINDS = Object.freeze({
  ARAHAN: { label: "Menunggu arahan" },
  KENDALA: { label: "Kendala pengerjaan" },
  LAINNYA: { label: "Lainnya" },
});

async function writeSkippedEvidence(tx, { run, stepNo, operationRunId = null, stageId = null, actorId, commandId, note = null }) {
  return writeEvidence(tx, { run, stepNo, operationRunId, stageId, payload: skippedEvidencePayload(note), media: [], actorId, commandId });
}

// Lewati SATU tahap (aksi sah mode adaptasi). body: { expectedRevision, workCenterId, note? }. stepNo harus salah satu nomor tahap yang ditutup tahap target.
export async function skipProductionStep(prisma, { runId, stepNo, actorId, idempotencyKey, expectedRevision, workCenterId, note = null }) {
  if (!runId) throw stepError("runId wajib diisi", 400, "STEP_RUN_REQUIRED");
  const requestedStep = Number(stepNo);
  if (!STEP_BY_NO[requestedStep]) throw stepError("Tahap tidak dikenal", 400, "STEP_UNKNOWN");
  assertIdempotencyKey(idempotencyKey);
  const revisionExpected = assertExpectedRevision(expectedRevision);
  const cleanNote = typeof note === "string" ? note.trim().slice(0, 300) || null : null;
  const actor = actorId || "SYSTEM";
  const requestHash = hash({ commandType: "SKIP_PRODUCTION_STEP", runId, stepNo: requestedStep, expectedRevision: revisionExpected, workCenterId: workCenterId || null, note: cleanNote });

  return prisma.$transaction(async (tx) => {
    // Ulangan kunci yang sama dijawab dari command tersimpan SEBELUM memuat run (run bisa sudah terminal setelah perintah pertama berhasil).
    const replay = await findReplay(tx, actor, idempotencyKey, requestHash);
    if (replay) return replay;
    const run = await loadRunForWrite(tx, runId);
    await assertWriterEnabledForUnit(tx, run.unitId);
    assertAdaptationRun(run);
    await authorizeOperator(tx, run, actorId, workCenterId, { postQc: await peekStartIsPostQc(tx, run) });
    assertRunRevision(run, revisionExpected);
    const prepared = await prepareSkipInTx(tx, run); // pra-cek kebijakan, konflik/drift, tahap target boleh dilewati
    const ctx = await loadStepContext(tx, run);
    const lastPreQc = ctx.split?.stages.at(-1) ?? null;
    const coveredAll = stepsCoveredByStage(prepared.stage, { isLastPreQc: !!lastPreQc && lastPreQc.id === prepared.stage.id });
    // Jalur pengerjaan: hanya tahap yang BERLAKU yang ditutup SKIPPED (tahap tidak berlaku tetap NA, tidak dikarang sebagai "dilewati").
    const covered = ctx.state.buildTrack ? coveredAll.filter((n) => applicableStepsFor(ctx.split, ctx.state.productFlow).includes(n)) : coveredAll;
    if (!covered.includes(requestedStep)) {
      throw stepError(`Tahap ${requestedStep} bukan tahap yang berikutnya. Tahap berikutnya: ${covered.join(", ") || "—"} (${prepared.stage.labelId}).`, 409, "STEP_OUT_OF_ORDER", { expectedStep: covered[0] ?? null, action: "SKIP" });
    }
    const command = await beginCommand(tx, { actor, idempotencyKey, commandType: "SKIP_PRODUCTION_STEP", aggregateId: runId, requestHash, expectedRevision: revisionExpected });
    const now = new Date();
    const transition = await applySkipStageInTx(tx, { run, prepared, actorId, note: cleanNote, now });
    const rows = [];
    for (const no of covered) {
      const hasEvidence = ctx.evidence.some((e) => e.stepNo === no);
      if (hasEvidence) continue; // tahap yang sudah punya bukti tidak ditimpa/digandakan
      rows.push(await writeSkippedEvidence(tx, { run, stepNo: no, operationRunId: transition.operationRunId, stageId: prepared.stage.id, actorId, commandId: command.id, note: cleanNote }));
    }
    await outbox(tx, {
      eventType: "production.step.skipped", aggregateId: run.id, revision: transition.revision, dedupeKey: `production-step-skipped:${run.id}:${transition.revision}`,
      payload: { runId: run.id, unitId: run.unitId, stepNos: covered, stageCode: prepared.stage.code, policy: ADAPTATION_POLICY, reason: SKIP_REASON, revision: transition.revision, occurredAt: now.toISOString(), actorId },
    });
    await recordActivity(tx, {
      entityType: "unit", entityId: run.unitId, eventType: EVENT_TYPES.PRODUCTION_STEP_SKIPPED, actorId: actorId || null,
      metadata: { unitCode: run.unit.unitCode, runId: run.id, stepNos: covered, stageLabel: prepared.stage.labelId, reason: SKIP_REASON, note: cleanNote },
    });
    const after = await loadRunForWrite(tx, run.id);
    const afterCtx = await loadStepContext(tx, after);
    const response = { runId: run.id, revision: after.revision, stepNo: requestedStep, action: "SKIP", skippedSteps: covered, evidenceIds: rows.map((r) => r.id), next: afterCtx.next };
    await finishCommand(tx, command, after.revision, response);
    return { replayed: false, ...response };
  }, { timeout: 20_000 });
}

// Penghalang & ringkasan untuk "Selesaikan Produksi" (BACA-SAJA; dipakai kartu dan pratinjau). Tidak menulis apa pun.
export async function previewFinishProduction(prisma, runId) {
  const run = await prisma.productionRun.findUnique({ where: { id: runId }, include: RUN_INCLUDE });
  if (!run) throw stepError("Production Run tidak ditemukan", 404, "WORKSHOP_RUN_NOT_FOUND");
  const ctx = await loadStepContext(prisma, run);
  const blockers = finishBlockersOf(run, { openShortage: !!ctx.openShortage, exceptionOpen: !!ctx.state.exceptionOpen });
  const pendingReturns = await prisma.productionMaterialReturn.findMany({ where: { runId, status: "PENDING" }, select: { qty: true, material: { select: { code: true, name: true, unit: true } } } });
  // Tahap routing yang BELUM tuntas (dari target sekarang sampai akhir) dan nomor tahap blueprint yang akan dicatat SKIPPED — pratinjau murni, tanpa tulisan.
  const path = ctx.path || [];
  const curId = ctx.state.activeOp?.stageId ?? ctx.state.target?.id ?? null;
  const done = ctx.state.target?.done === true;
  const idx = done ? path.length : (curId ? path.findIndex((s) => s.id === curId) : 0);
  const remainingStages = path.slice(Math.max(0, idx)).map((s) => ({ id: s.id, code: s.code, label: s.labelId, isQcGate: !!s.requiresQc }));
  const applicable = applicableStepsFor(ctx.split, ctx.state?.productFlow ?? "KASUR");
  const recorded = new Set(ctx.evidence.map((e) => e.stepNo));
  const willSkipSteps = applicable.filter((n) => !recorded.has(n)).map((n) => ({ no: n, label: STEP_BY_NO[n].label }));
  const doneSteps = ctx.evidence.filter((e) => !isSkippedEvidence(e)).map((e) => e.stepNo);
  const leftovers = (await computeRunLeftovers(prisma, run)) || [];
  const mats = leftovers.length ? await prisma.material.findMany({ where: { id: { in: leftovers.map((l) => l.materialId) } }, select: { id: true, code: true, name: true, unit: true } }) : [];
  const mById = new Map(mats.map((m) => [m.id, m]));
  return {
    runId, revision: run.revision, adaptation: isAdaptationRun(run), canFinish: blockers.length === 0, blockers,
    remainingStages, willSkipSteps, qcNotPerformed: remainingStages.some((s) => s.isQcGate) || !ctx.latestInspection,
    progress: { worked: [...new Set(doneSteps)].length, skipped: ctx.evidence.filter(isSkippedEvidence).length, remaining: willSkipSteps.length },
    expectedReturns: leftovers.map((l) => ({ code: mById.get(l.materialId)?.code ?? null, name: mById.get(l.materialId)?.name ?? null, unit: mById.get(l.materialId)?.unit ?? null, qty: l.qty })),
    pendingReturns: pendingReturns.map((r) => ({ code: r.material.code, name: r.material.name, unit: r.material.unit ?? null, qty: Number(r.qty) })),
    statement: "Tahap yang belum dikerjakan akan dicatat DILEWATI (Adaptasi sistem). QC dicatat tidak dilakukan — bukan lulus. Tidak ada penerimaan barang jadi Gudang dan tidak ada foto/hasil uji yang dibuat.",
  };
}

// Penutup boleh PIC Meja ATAU PIC Corner yang ditugaskan (tahap terakhir dikerjakan Corner, jadi PIC Corner adalah pihak yang paling wajar menutup); selain keduanya ditolak seperti biasa.
// Pesan galat yang dilempar adalah galat PIC Meja (jalur utama) bila keduanya gagal.
async function authorizeFinishOperator(tx, run, actorId, workCenterId) {
  try { return await authorizeOperator(tx, run, actorId, workCenterId, { postQc: false }); }
  catch (error) {
    if (!["WORKSHOP_OPERATOR_MISMATCH", "WORKSHOP_WORK_CENTER_MISMATCH"].includes(error.code) || !run.plan?.cornerOperatorId) throw error;
    try { return await authorizeOperator(tx, run, actorId, workCenterId, { postQc: true }); } catch { throw error; }
  }
}

// Selesaikan Produksi (mode adaptasi): menutup lifecycle yang diperlukan SECARA EKSPLISIT lalu unit Siap Kirim. Retur sisa bahan tetap WAJIB: bila ada sisa yang belum diterima
// Gudang, antrean retur dibuka dan command berhenti dengan alasan jelas (completed:false) — tidak dilewati diam-diam. body: { expectedRevision, workCenterId }.
export async function finishProduction(prisma, { runId, actorId, idempotencyKey, expectedRevision, workCenterId }) {
  if (!runId) throw stepError("runId wajib diisi", 400, "STEP_RUN_REQUIRED");
  assertIdempotencyKey(idempotencyKey);
  const revisionExpected = assertExpectedRevision(expectedRevision);
  const actor = actorId || "SYSTEM";
  const requestHash = hash({ commandType: "FINISH_PRODUCTION", runId, expectedRevision: revisionExpected, workCenterId: workCenterId || null });

  return prisma.$transaction(async (tx) => {
    // Ulangan kunci yang sama dijawab dari command tersimpan SEBELUM memuat run (run bisa sudah terminal setelah perintah pertama berhasil).
    const replay = await findReplay(tx, actor, idempotencyKey, requestHash);
    if (replay) return replay;
    const run = await loadRunForWrite(tx, runId);
    await assertWriterEnabledForUnit(tx, run.unitId);
    const ctx = await loadStepContext(tx, run);
    const blockers = finishBlockersOf(run, { openShortage: !!ctx.openShortage, exceptionOpen: !!ctx.state.exceptionOpen });
    if (blockers.length) throw stepError(`Produksi belum bisa diselesaikan: ${blockers[0].text}`, 409, `FINISH_${blockers[0].code}`, { blockers });
    await authorizeFinishOperator(tx, run, actorId, workCenterId);
    assertRunRevision(run, revisionExpected);
    await assertNoOpenRunException(tx, run.id);

    // Retur sisa bahan WAJIB (stok kembali tepat sekali lewat service retur/Gudang). Dibuka lebih dulu; bila masih ada yang PENDING -> berhenti, TANPA menutup lifecycle.
    await createLeftoverReturnsInTx(tx, { run, actorId, commandId: null });
    const pending = await tx.productionMaterialReturn.findMany({ where: { runId, status: "PENDING" }, select: { qty: true, material: { select: { code: true, name: true, unit: true } } } });
    if (pending.length) {
      return {
        replayed: false, runId, revision: run.revision, completed: false, waitingFor: "GUDANG_RETUR",
        message: `Sisa bahan harus diterima Gudang dulu (${pending.map((p) => `${p.material.code} ${Number(p.qty)}`).join(", ")}). Setelah retur diterima, tekan Selesaikan Produksi lagi.`,
        pendingReturns: pending.map((r) => ({ code: r.material.code, name: r.material.name, unit: r.material.unit ?? null, qty: Number(r.qty) })),
      };
    }

    const command = await beginCommand(tx, { actor, idempotencyKey, commandType: "FINISH_PRODUCTION", aggregateId: runId, requestHash, expectedRevision: revisionExpected });
    const now = new Date();
    const result = await applyAdaptationFinishInTx(tx, { run, actorId, now });
    const applicable = applicableStepsFor(ctx.split, ctx.state?.productFlow ?? "KASUR");
    const written = [];
    for (const no of applicable) {
      if (ctx.evidence.some((e) => e.stepNo === no)) continue;
      written.push((await writeSkippedEvidence(tx, { run, stepNo: no, actorId, commandId: command.id, note: "Selesaikan Produksi" })).stepNo);
    }
    await outbox(tx, {
      eventType: "production.finished.adaptation", aggregateId: run.id, revision: result.revision, dedupeKey: `production-finished-adaptation:${run.id}:${result.revision}`,
      payload: { runId: run.id, unitId: run.unitId, policy: ADAPTATION_POLICY, skippedStages: result.skipped.map((s) => s.code), skippedSteps: written, qcNotPerformed: result.qcNotPerformed, revision: result.revision, occurredAt: now.toISOString(), actorId },
    });
    if (result.qcNotPerformed) {
      await recordActivity(tx, {
        entityType: "unit", entityId: run.unitId, eventType: EVENT_TYPES.PRODUCTION_QC_NOT_PERFORMED, actorId: actorId || null,
        metadata: { unitCode: run.unit.unitCode, runId: run.id, reason: SKIP_REASON },
      });
    }
    if (written.length) {
      await recordActivity(tx, {
        entityType: "unit", entityId: run.unitId, eventType: EVENT_TYPES.PRODUCTION_STEP_SKIPPED, actorId: actorId || null,
        metadata: { unitCode: run.unit.unitCode, runId: run.id, stepNos: written, stageLabel: "Selesaikan Produksi", reason: SKIP_REASON },
      });
    }
    await recordActivity(tx, {
      entityType: "unit", entityId: run.unitId, eventType: EVENT_TYPES.PRODUCTION_FINISHED_ADAPTATION, actorId: actorId || null,
      metadata: { unitCode: run.unit.unitCode, runId: run.id, skippedCount: written.length, skippedStages: result.skipped.map((s) => s.label) },
    });
    const response = {
      runId: run.id, revision: result.revision, completed: true, unitStatus: result.unitStatus, skippedSteps: written, skippedStages: result.skipped.map((s) => ({ code: s.code, label: s.label })),
      qc: (await tx.qualityInspection.count({ where: { runId: run.id, result: { not: "PENDING" } } })) > 0 ? "SUDAH_DILAKUKAN" : "TIDAK_DILAKUKAN", handoffGudang: "TIDAK_DIWAJIBKAN",
    };
    await finishCommand(tx, command, result.revision, response);
    return { replayed: false, ...response };
  }, { timeout: 30_000 });
}

// Terapkan kebijakan adaptasi pada run yang sudah berjalan (aksi EKSPLISIT Admin/Lead; run lama tidak pernah diubah otomatis). Tidak mengubah tahap/bukti/stok.
export async function applyAdaptationPolicy(prisma, { runId, actorId, idempotencyKey, expectedRevision, reason = null }) {
  if (!runId) throw stepError("runId wajib diisi", 400, "STEP_RUN_REQUIRED");
  assertIdempotencyKey(idempotencyKey);
  const revisionExpected = assertExpectedRevision(expectedRevision);
  const cleanReason = typeof reason === "string" ? reason.trim().slice(0, 300) || null : null;
  const actor = actorId || "SYSTEM";
  const requestHash = hash({ commandType: "APPLY_ADAPTATION_POLICY", runId, expectedRevision: revisionExpected, reason: cleanReason });
  return prisma.$transaction(async (tx) => {
    // Ulangan kunci yang sama dijawab dari command tersimpan SEBELUM memuat run (run bisa sudah terminal setelah perintah pertama berhasil).
    const replay = await findReplay(tx, actor, idempotencyKey, requestHash);
    if (replay) return replay;
    const run = await loadRunForWrite(tx, runId);
    await assertWriterEnabledForUnit(tx, run.unitId);
    assertRunRevision(run, revisionExpected);
    await assertNoOpenRunException(tx, run.id);
    const command = await beginCommand(tx, { actor, idempotencyKey, commandType: "APPLY_ADAPTATION_POLICY", aggregateId: runId, requestHash, expectedRevision: revisionExpected });
    const applied = await applyAdaptationPolicyInTx(tx, { run });
    if (applied.changed) {
      await recordActivity(tx, {
        entityType: "unit", entityId: run.unitId, eventType: EVENT_TYPES.PRODUCTION_ADAPTATION_APPLIED, actorId: actorId || null,
        metadata: { unitCode: run.unit.unitCode, runId: run.id, reason: cleanReason, policy: ADAPTATION_POLICY },
      });
    }
    const response = { runId, revision: applied.revision, policy: ADAPTATION_POLICY, changed: applied.changed };
    await finishCommand(tx, command, applied.revision, response);
    return { replayed: false, ...response };
  });
}

// Tunda Pekerjaan pada pekerjaan DI PAPAN dengan alasan Menunggu arahan / Kendala pengerjaan / Lainnya ("Lainnya" wajib keterangan >= 3 huruf). "Menunggu bahan" tetap
// lewat laporan kekurangan bahan (reportMaterialShortage) karena butuh daftar bahan dan hanya Gudang yang menutupnya. Jeda (PauseReason) TIDAK disamakan.
export async function delayProductionWork(prisma, { runId, actorId, idempotencyKey, expectedRevision, workCenterId, reason, note = null }) {
  if (!runId) throw stepError("runId wajib diisi", 400, "STEP_RUN_REQUIRED");
  assertIdempotencyKey(idempotencyKey);
  const revisionExpected = assertExpectedRevision(expectedRevision);
  const kind = DELAY_KINDS[reason] ? reason : null;
  if (!kind) throw stepError('Alasan tunda harus "Menunggu arahan", "Kendala pengerjaan", atau "Lainnya" (menunggu bahan lewat laporan bahan kurang)', 400, "DELAY_REASON_INVALID");
  const cleanNote = typeof note === "string" ? note.trim().slice(0, 300) || null : null;
  if (kind === "LAINNYA" && (!cleanNote || cleanNote.length < 3)) throw stepError('Alasan "Lainnya" wajib disertai keterangan yang jelas', 400, "DELAY_NOTE_REQUIRED");
  const actor = actorId || "SYSTEM";
  const requestHash = hash({ commandType: "DELAY_PRODUCTION_WORK", runId, expectedRevision: revisionExpected, workCenterId: workCenterId || null, kind, note: cleanNote });
  return prisma.$transaction(async (tx) => {
    // Ulangan kunci yang sama dijawab dari command tersimpan SEBELUM memuat run (run bisa sudah terminal setelah perintah pertama berhasil).
    const replay = await findReplay(tx, actor, idempotencyKey, requestHash);
    if (replay) return replay;
    const run = await loadRunForWrite(tx, runId);
    await assertWriterEnabledForUnit(tx, run.unitId);
    const op = activeOperation(run);
    if (!op) throw stepError("Tidak ada tahap yang sedang berjalan untuk ditunda", 409, "DELAY_NO_ACTIVE_STAGE");
    if (op.status !== "ACTIVE") throw stepError("Pekerjaan ini sudah tertunda", 409, "DELAY_ALREADY_DELAYED", { delayKind: op.delayKind ?? null });
    await authorizeOperator(tx, run, actorId, workCenterId, { postQc: await isPostQcStage(tx, run, op.stageId) });
    assertRunRevision(run, revisionExpected);
    await assertNoOpenRunException(tx, run.id);
    const command = await beginCommand(tx, { actor, idempotencyKey, commandType: "DELAY_PRODUCTION_WORK", aggregateId: runId, requestHash, expectedRevision: revisionExpected });
    const result = await applyDelayInTx(tx, { run, op, actorId, kind, label: DELAY_KINDS[kind].label, note: cleanNote });
    await recordActivity(tx, {
      entityType: "unit", entityId: run.unitId, eventType: EVENT_TYPES.PRODUCTION_WORK_DELAYED, actorId: actorId || null,
      metadata: { unitCode: run.unit.unitCode, runId, reasonKey: kind, reasonLabel: DELAY_KINDS[kind].label, note: cleanNote },
    });
    const response = { runId, revision: result.revision, status: "PAUSED", delayKind: kind };
    await finishCommand(tx, command, result.revision, response);
    return { replayed: false, ...response };
  });
}

// Lanjutkan Pekerjaan (pekerjaan di papan): SATU aksi atomik & idempoten. Menunggu bahan TIDAK bisa dibuka sebelum masalah bahan diselesaikan Gudang (409 RESUME_WAITING_MATERIAL).
// Pekerjaan yang sudah berjalan -> alreadyActive:true (tidak ada tulisan). expectedRevision opsional (dikirim kartu; bila ada dan basi -> 409).
export async function resumeProductionWork(prisma, { runId, actorId, idempotencyKey, expectedRevision = null, workCenterId = null }) {
  if (!runId) throw stepError("runId wajib diisi", 400, "STEP_RUN_REQUIRED");
  assertIdempotencyKey(idempotencyKey);
  const revisionExpected = expectedRevision == null || expectedRevision === "" ? null : assertExpectedRevision(expectedRevision);
  const actor = actorId || "SYSTEM";
  const requestHash = hash({ commandType: "RESUME_PRODUCTION_WORK", runId, expectedRevision: revisionExpected, workCenterId: workCenterId || null });
  return prisma.$transaction(async (tx) => {
    // Ulangan kunci yang sama dijawab dari command tersimpan SEBELUM memuat run (run bisa sudah terminal setelah perintah pertama berhasil).
    const replay = await findReplay(tx, actor, idempotencyKey, requestHash);
    if (replay) return replay;
    const run = await loadRunForWrite(tx, runId);
    await assertWriterEnabledForUnit(tx, run.unitId);
    const op = activeOperation(run);
    if (!op) throw stepError("Tidak ada pekerjaan yang sedang ditunda", 409, "RESUME_NOTHING_TO_RESUME");
    const wc = workCenterId || run.plan?.workCenterId || null;
    await authorizeOperator(tx, run, actorId, wc, { postQc: await isPostQcStage(tx, run, op.stageId) });
    if (revisionExpected != null) assertRunRevision(run, revisionExpected);
    await assertNoOpenRunException(tx, run.id);
    if (op.status === "ACTIVE") {
      const response = { runId, revision: run.revision, status: "ACTIVE", resumed: false, alreadyActive: true };
      const command = await beginCommand(tx, { actor, idempotencyKey, commandType: "RESUME_PRODUCTION_WORK", aggregateId: runId, requestHash, expectedRevision: revisionExpected });
      await finishCommand(tx, command, run.revision, response);
      return { replayed: false, ...response };
    }
    const shortage = await tx.productionMaterialShortage.findFirst({ where: { runId, status: "OPEN" }, select: { id: true } });
    if (shortage) throw stepError("Menunggu bahan: Gudang belum menyelesaikan masalah bahan. Pekerjaan baru bisa dilanjutkan setelah bahan diserahkan.", 409, "RESUME_WAITING_MATERIAL", { shortageId: shortage.id, waitingFor: "GUDANG" });
    const command = await beginCommand(tx, { actor, idempotencyKey, commandType: "RESUME_PRODUCTION_WORK", aggregateId: runId, requestHash, expectedRevision: revisionExpected });
    const previous = op.delayKind ? DELAY_KINDS[op.delayKind]?.label ?? null : null;
    const result = await applyResumeInTx(tx, { run, op, actorId });
    await recordActivity(tx, {
      entityType: "unit", entityId: run.unitId, eventType: EVENT_TYPES.PRODUCTION_WORK_RESUMED, actorId: actorId || null,
      metadata: { unitCode: run.unit.unitCode, runId, reasonLabel: previous },
    });
    const response = { runId, revision: result.revision, status: "ACTIVE", resumed: true, alreadyActive: false };
    await finishCommand(tx, command, result.revision, response);
    return { replayed: false, ...response };
  });
}

export { RUN_INCLUDE };
