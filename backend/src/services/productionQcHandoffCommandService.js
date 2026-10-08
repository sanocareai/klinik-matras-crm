// Command owner QC V2 + rework + handoff barang jadi + rekonsiliasi override V1 (Production Workshop + Warehouse V2, slice P6).
// Penulis TUNGGAL quality_inspections_v2/quality_inspection_items_v2 dan production_run_exceptions_v2; penulis fase QC/HANDOFF (bersama custody
// untuk keputusan Gudang) dan pembatalan run. Lihat scripts/production-delivery-v2/audit-qc-handoff-writers.js.
//
// Alur lifecycle (setelah P5 mencapai AWAITING_QC):
//   AWAITING_QC --QC PASS/WAIVED--> PROCESS (tahap SETELAH gerbang: Jahit Corner, Finish; dieksekusi lewat command P5) --tahap terakhir selesai (P5)-->
//   HANDOFF (penawaran custody FINISHED_GOODS dibuat SAAT ITU, bukan saat QC) --Gudang ACCEPTED--> run COMPLETED + unit READY_FOR_DELIVERY.
//   AWAITING_QC --QC FAIL--> PROCESS (rework pada tahap yang DITENTUKAN EKSPLISIT sebelum gerbang; wajib QC ulang)
//   HANDOFF --Gudang REJECTED--> HANDOFF BLOCKED (kasus kembali ke Production) --tawarkan ulang | rework--> HANDOFF | PROCESS.
//
// Kontrak:
//  - Idempotency-Key + expectedRevision (revisi Production Run) wajib; kunci unit -> run (urutan P5; kunci plan lebih dulu HANYA bila memuat bahan
//    tambahan, sama dengan urutan plan -> ... P3/P4), semua dalam SATU transaksi bersama command, outbox, inspeksi, proyeksi V1, dan audit.
//  - quality_inspections_v2 = sumber kebenaran QC; proyeksi qc_fit_tests V1 + ledger tahap V1 ditulis lewat primitive *InTx engine di transaksi
//    yang SAMA (replay tidak menggandakan keduanya). QC_WAIVED TIDAK pernah dicatat sebagai PASS dan tidak memproyeksikan qc_fit_tests.
//  - Bahan tambahan rework: baris BOM + reservasi + Material Issue BARU terhubung ke inspeksi (jalur P3/P4); reservasi asli CONSUMED tidak disentuh.
//  - Fail-closed: command menolak run yang statusnya tidak konsisten dengan unit (override V1) atau yang punya exception OPEN.
import { createHash } from "node:crypto";
import { recordActivity, EVENT_TYPES } from "../lib/activityLog.js";
import { lockRowForUpdate } from "./inventoryLedger.js";
import {
  isUnitPathDoneInTx, recordQcFitTestInTx, reopenStageBeforeQcInTx, restoreUnitStatusInTx, startStageInTx, waiveQcGateInTx, pathForUnit, buildTrackUnits,
} from "./unitStageEngine.js";
import { cancelOfferedFinishedGoodsCustodyInTx, offerFinishedGoodsCustodyInTx } from "./unitCustodyCommandService.js";
import { assertPlanBOMLines, loadPlanForWrite, reserveSupplementalInTx } from "./productionPlanningCommandService.js";
import { createSupplementalIssueInTx } from "./productionMaterialIssueCommandService.js";
import { getWorkshopRun, hasAssemblyGate, isAdaptationRun, workshopPathOf } from "./productionWorkshopExecutionCommandService.js";
import {
  ALLOWED_RESOLUTIONS, RUN_OWNED_STATUSES, RUN_TERMINAL_STATUSES, assertNoOpenRunException, assertRunConsistent, detectRunInconsistency,
} from "./productionRunGuards.js";
import { loadAssemblyGateFactsForRun, loadBuildSummary } from "./productionStepCommandService.js";
import { assertRunPhasesTerminal, transitionPhases } from "./productionPhaseLifecycle.js";
import { isProductionWriterEnabledFor, loadV2Flags, resolveProductionWriterState } from "./v2FeatureFlags.js";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{12,128}$/;
const FIT_VERDICTS = ["PAS", "TERLALU_KERAS", "TERLALU_EMPUK"];
const OVERRIDES = ["LEBIH_KERAS", "LEBIH_EMPUK"];
const ITEM_RESULTS = ["OK", "NOT_OK", "NA"];
const RESULT_TO_DB = Object.freeze({ PASS: "PASS", FAIL: "FAIL_REWORK", WAIVED: "OVERRIDDEN" });
const MIN_WAIVE_REASON = 10;

function qcError(message, statusCode, code, details) {
  return Object.assign(new Error(message), { statusCode, code, ...(details ? { details } : {}) });
}
const hash = (value) => createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");

export function assertIdempotencyKey(key) {
  if (!key || !IDEMPOTENCY_KEY.test(key)) throw qcError("Idempotency-Key wajib diisi (12-128 karakter)", 400, "IDEMPOTENCY_KEY_INVALID");
}
export function assertExpectedRevision(value) {
  const revision = Number(value);
  if (value == null || value === "" || !Number.isInteger(revision) || revision < 1) {
    throw qcError("expectedRevision wajib diisi (angka bulat positif)", 400, "EXPECTED_REVISION_REQUIRED");
  }
  return revision;
}
export function assertRunRevision(run, expectedRevision) {
  if (run.revision !== expectedRevision) {
    throw qcError(`Revisi Production Run berubah: diharapkan ${expectedRevision}, sekarang ${run.revision}. Muat ulang.`, 409, "QC_REVISION_CONFLICT", { revision: run.revision });
  }
}

// Profil pemeriksaan QC menurut alur produk: KASUR (uji berat badan) | GENERIC (divan/sofa) | UNCONFIRMED (jenis belum jelas: ditahan). Jalur lama (bukan BUILD) = KASUR.
const qcProfileOf = (info) => (!info ? "KASUR" : info.flow === "NON_KASUR" ? "GENERIC" : info.flow === "UNCONFIRMED" ? "UNCONFIRMED" : "KASUR");
const cleanUrls = (value) => (Array.isArray(value) ? value.map((u) => String(u ?? "").trim()).filter(Boolean) : []);

// Validasi + normalisasi input inspeksi (murni; diuji unit). Mengembalikan objek ternormalisasi atau melempar galat 400/422 berkode.
// generic = pemeriksaan hasil NON-kasur (divan/sofa, jalur pengerjaan): TANPA berat acuan/uji berat badan — keputusan lulus/gagal + foto + catatan saja.
export function validateInspectionInput(input = {}, { generic = false } = {}) {
  const result = String(input.result ?? "").toUpperCase();
  if (!RESULT_TO_DB[result]) throw qcError("Hasil QC harus PASS, FAIL, atau WAIVED", 400, "QC_RESULT_INVALID");
  const photoUrls = cleanUrls(input.photoUrls);
  if (photoUrls.length > 12) throw qcError("Maksimal 12 foto bukti per inspeksi", 400, "QC_EVIDENCE_TOO_MANY");
  const note = String(input.note ?? "").trim();
  const out = { result, photoUrls, note };

  if (result === "WAIVED") {
    const reason = String(input.reason ?? "").trim();
    if (reason.length < MIN_WAIVE_REASON) throw qcError(`Alasan QC_WAIVED wajib diisi (minimal ${MIN_WAIVE_REASON} karakter)`, 400, "QC_WAIVE_REASON_REQUIRED");
    if (Array.isArray(input.supplementalMaterials) && input.supplementalMaterials.length) throw qcError("QC_WAIVED tidak boleh membuka bahan tambahan", 422, "QC_WAIVE_NO_MATERIAL");
    return { ...out, reason, items: [], supplementalMaterials: [] };
  }

  if (photoUrls.length === 0) throw qcError("Foto bukti wajib untuk PASS/FAIL", 400, "QC_EVIDENCE_REQUIRED");
  if (!generic) {
    const weight = Number(input.referenceWeightKg);
    if (!Number.isInteger(weight) || weight <= 0) throw qcError("Berat acuan (kg, bilangan bulat > 0) wajib diisi", 400, "QC_WEIGHT_REQUIRED");
    out.referenceWeightKg = weight;
  }

  const items = [];
  if (input.items != null) {
    if (!Array.isArray(input.items) || input.items.length > 20) throw qcError("Checklist QC maksimal 20 butir", 400, "QC_ITEMS_INVALID");
    const seen = new Set(["OVERALL"]);
    input.items.forEach((item, index) => {
      const code = String(item?.itemCode ?? "").toUpperCase();
      if (!/^[A-Z0-9_]{2,40}$/.test(code) || seen.has(code)) throw qcError(`Butir checklist #${index + 1} tidak valid atau ganda`, 400, "QC_ITEMS_INVALID");
      seen.add(code);
      const itemResult = String(item?.result ?? "").toUpperCase();
      if (!ITEM_RESULTS.includes(itemResult)) throw qcError(`Hasil butir ${code} harus OK/NOT_OK/NA`, 400, "QC_ITEMS_INVALID");
      const label = String(item?.label ?? "").trim();
      if (!label) throw qcError(`Label butir ${code} wajib diisi`, 400, "QC_ITEMS_INVALID");
      items.push({ itemCode: code, label, result: itemResult, note: String(item?.note ?? "").trim() || null, photoUrls: cleanUrls(item?.photoUrls) });
    });
  }

  if (generic) {
    if (input.customerPreferenceOverride || input.fitVerdict) throw qcError("Produk non-kasur tidak memakai uji berat badan/tekstur kasur", 422, "QC_GENERIC_NO_FIT");
    if (items.some((item) => item.result === "NOT_OK") && result === "PASS") throw qcError("PASS tidak boleh memuat butir checklist NOT_OK", 422, "QC_ITEM_CONTRADICTS");
    if (result === "PASS") return { ...out, generic: true, fitVerdict: null, customerPreferenceOverride: null, educationGiven: false, items, supplementalMaterials: [] };
    if (note.length < 3) throw qcError("Catatan temuan wajib diisi untuk FAIL (minimal 3 karakter)", 400, "QC_NOTE_REQUIRED");
    if (!input.reworkStageId) throw qcError("Tahap rework wajib ditentukan secara eksplisit", 400, "QC_REWORK_STAGE_REQUIRED");
    const supplementalMaterials = Array.isArray(input.supplementalMaterials) ? input.supplementalMaterials.map((l) => ({ materialId: l?.materialId, qty: Number(l?.qty) })) : [];
    if (supplementalMaterials.length) assertPlanBOMLines(supplementalMaterials);
    return { ...out, generic: true, fitVerdict: null, reworkStageId: input.reworkStageId, items, supplementalMaterials };
  }

  if (result === "PASS") {
    const fitVerdict = String(input.fitVerdict ?? "PAS").toUpperCase();
    if (!FIT_VERDICTS.includes(fitVerdict)) throw qcError("Hasil uji berat badan tidak dikenal", 400, "QC_VERDICT_INVALID");
    const override = input.customerPreferenceOverride ? String(input.customerPreferenceOverride).toUpperCase() : null;
    if (override && !OVERRIDES.includes(override)) throw qcError("Override preferensi customer tidak dikenal", 400, "QC_VERDICT_INVALID");
    if (fitVerdict !== "PAS" && !(override && input.educationGiven === true)) {
      throw qcError("PASS hanya untuk hasil PAS, atau override preferensi customer yang disertai konfirmasi edukasi", 422, "QC_VERDICT_NOT_PASSING");
    }
    if (fitVerdict === "PAS" && override) throw qcError("Override preferensi customer hanya berlaku untuk hasil TERLALU_KERAS/TERLALU_EMPUK", 422, "QC_VERDICT_INVALID");
    if (items.some((item) => item.result === "NOT_OK")) throw qcError("PASS tidak boleh memuat butir checklist NOT_OK", 422, "QC_ITEM_CONTRADICTS");
    return { ...out, fitVerdict, customerPreferenceOverride: override, educationGiven: input.educationGiven === true, items, supplementalMaterials: [] };
  }

  // FAIL
  const fitVerdict = String(input.fitVerdict ?? "").toUpperCase();
  if (!["TERLALU_KERAS", "TERLALU_EMPUK"].includes(fitVerdict)) throw qcError("FAIL wajib menyebut hasil uji berat badan (TERLALU_KERAS atau TERLALU_EMPUK)", 422, "QC_FAIL_VERDICT_REQUIRED");
  if (input.customerPreferenceOverride) throw qcError("FAIL tidak boleh disertai override preferensi customer", 422, "QC_VERDICT_INVALID");
  if (note.length < 3) throw qcError("Catatan temuan wajib diisi untuk FAIL (minimal 3 karakter)", 400, "QC_NOTE_REQUIRED");
  if (!input.reworkStageId) throw qcError("Tahap rework wajib ditentukan secara eksplisit", 400, "QC_REWORK_STAGE_REQUIRED");
  const supplementalMaterials = Array.isArray(input.supplementalMaterials) ? input.supplementalMaterials.map((l) => ({ materialId: l?.materialId, qty: Number(l?.qty) })) : [];
  if (supplementalMaterials.length) assertPlanBOMLines(supplementalMaterials);
  return { ...out, fitVerdict, reworkStageId: input.reworkStageId, items, supplementalMaterials };
}

async function beginCommand(tx, { actor, idempotencyKey, commandType, aggregateId, requestHash, expectedRevision = null }) {
  return tx.v2Command.create({
    data: { domain: "PRODUCTION", actorId: actor, idempotencyKey, commandType, aggregateType: "ProductionRun", aggregateId, expectedRevision, requestHash },
  });
}
async function finishCommand(tx, command, appliedRevision, response) {
  await tx.v2Command.update({ where: { id: command.id }, data: { status: "APPLIED", appliedRevision, response, completedAt: new Date() } });
}
async function outbox(tx, { eventType, aggregateType = "ProductionRun", aggregateId, revision, dedupeKey, payload }) {
  return tx.domainOutbox.create({ data: { domain: "PRODUCTION", eventType, aggregateType, aggregateId, aggregateRevision: revision, dedupeKey, payload } });
}
async function findReplay(tx, actor, idempotencyKey, requestHash) {
  const replay = await tx.v2Command.findUnique({ where: { actorId_idempotencyKey: { actorId: actor, idempotencyKey } } });
  if (!replay) return null;
  if (replay.requestHash !== requestHash) throw qcError("Idempotency-Key dipakai untuk payload berbeda", 409, "IDEMPOTENCY_CONFLICT");
  if (replay.status !== "APPLIED") throw qcError("Command masih diproses", 409, "COMMAND_IN_PROGRESS");
  return { replayed: true, ...replay.response };
}
async function assertWriterEnabledForUnit(tx, unitId) {
  const state = resolveProductionWriterState(await loadV2Flags(tx));
  if (!isProductionWriterEnabledFor(state, unitId)) throw qcError("QC/handoff V2 tidak aktif untuk unit ini; gunakan alur lama", 503, "QC_WRITER_OFF");
}
// Kesalahan transisi engine V1 (StageTransitionError) dipetakan ke galat berkode dengan status ASLI engine.
async function viaEngine(fn) {
  try { return await fn(); } catch (error) {
    if (error?.name !== "Error" || typeof error.statusCode !== "number" || error.code) throw error;
    throw qcError(error.message, error.statusCode, "QC_STAGE_TRANSITION_INVALID");
  }
}

const RUN_INCLUDE = {
  unit: { select: { id: true, unitCode: true, orderId: true, serviceId: true, status: true, currentStageId: true } },
  phases: true,
  operations: { orderBy: { sequence: "asc" } },
  inspections: { orderBy: { version: "desc" }, take: 1 },
  plan: { select: { id: true, status: true, revision: true } },
};

// Urutan kunci: [plan bila memuat bahan tambahan] -> unit -> run (P3/P4: plan lebih dulu; P5: unit -> run). Tidak pernah run -> unit.
async function loadRunLocked(tx, runId, { withPlan = false } = {}) {
  const pre = await tx.productionRun.findUnique({ where: { id: runId }, select: { unitId: true, plan: { select: { id: true } } } });
  if (!pre) throw qcError("Production Run tidak ditemukan", 404, "QC_RUN_NOT_FOUND");
  if (withPlan && pre.plan) await lockRowForUpdate(tx, "production_run_plans_v2", pre.plan.id);
  await lockRowForUpdate(tx, "units", pre.unitId);
  await lockRowForUpdate(tx, "production_runs_v2", runId);
  return tx.productionRun.findUnique({ where: { id: runId }, include: RUN_INCLUDE });
}

const phaseOf = (run, phase) => run.phases.find((p) => p.phase === phase);
const activeOperation = (run) => run.operations.find((op) => op.status === "ACTIVE" || op.status === "PAUSED") || null;
function assertRunOpen(run) {
  if (RUN_TERMINAL_STATUSES.includes(run.status)) throw qcError("Production Run sudah selesai/dibatalkan", 409, "QC_RUN_TERMINAL", { status: run.status });
}
async function bumpRun(tx, run, data = {}) {
  const revision = run.revision + 1;
  await tx.productionRun.update({ where: { id: run.id }, data: { ...data, revision } });
  return revision;
}

// ---------------------------------------------------------------------------
// 1. INSPEKSI QC (PASS / FAIL / WAIVED) untuk run AWAITING_QC.
// ---------------------------------------------------------------------------
export async function recordQualityInspection(prisma, { runId, actorId, canInspect = false, canWaive = false, idempotencyKey, expectedRevision, ...input }) {
  if (!runId) throw qcError("runId wajib diisi", 400, "QC_RUN_ID_REQUIRED");
  assertIdempotencyKey(idempotencyKey);
  const revisionExpected = assertExpectedRevision(expectedRevision);
  // Profil QC ditentukan SERVER dari jenis produk kanonis (bukan dari isian klien): NON-kasur pada jalur pengerjaan = pemeriksaan hasil tanpa uji berat badan.
  const pre = await prisma.productionRun.findUnique({ where: { id: runId }, select: { unitId: true } });
  const preInfo = pre ? (await buildTrackUnits(prisma, [pre.unitId])).get(pre.unitId) : null;
  // Jenis produk belum jelas: TIDAK ada uji berat badan kasur maupun pemeriksaan generik (tanpa fallback ke kasur) sampai jenis dikonfirmasi pada order.
  if (preInfo?.flow === "UNCONFIRMED" && String(input.result ?? "").toUpperCase() !== "WAIVED") throw qcError(preInfo.problem || "Jenis produk belum jelas — konfirmasi jenis produk dulu", 409, "QC_PRODUCT_TYPE_UNCONFIRMED");
  const generic = preInfo?.flow === "NON_KASUR";
  const data = validateInspectionInput(input, { generic });
  if (data.result === "WAIVED" ? !canWaive : !canInspect) {
    throw qcError(data.result === "WAIVED" ? "Hanya pihak berwenang (QC_WAIVE) yang boleh mem-waive QC" : "Anda tidak berwenang memutuskan hasil QC (QC_WRITE)", 403, data.result === "WAIVED" ? "QC_WAIVE_FORBIDDEN" : "QC_WRITE_REQUIRED");
  }
  const actor = actorId || "SYSTEM";
  const requestHash = hash({ commandType: "RECORD_QC", runId, expectedRevision: revisionExpected, data });

  return prisma.$transaction(async (tx) => {
    const run = await loadRunLocked(tx, runId, { withPlan: data.supplementalMaterials.length > 0 });
    const replay = await findReplay(tx, actor, idempotencyKey, requestHash);
    if (replay) return replay;
    await assertWriterEnabledForUnit(tx, run.unitId);
    assertRunOpen(run);
    assertRunConsistent(run, run.unit);
    await assertNoOpenRunException(tx, run.id);
    assertRunRevision(run, revisionExpected);
    // Jalur pengerjaan: pengujian khusus kasur DITAHAN sampai jenis produk kanonis jelas; jalur setelah QC (Corner) harus sudah dikonfirmasi pada rencana sebelum QC lulus/di-waive.
    const buildInfo = (await buildTrackUnits(tx, [run.unitId])).get(run.unitId);
    if (buildInfo) {
      if (buildInfo.flow === "UNCONFIRMED" && data.result !== "WAIVED") throw qcError(buildInfo.problem || "Jenis produk belum jelas — konfirmasi jenis produk dulu", 409, "QC_PRODUCT_TYPE_UNCONFIRMED");
      if (buildInfo.cornerRequired == null && data.result !== "FAIL") throw qcError("Kebutuhan Corner belum dikonfirmasi pada rencana — Lead perlu mengonfirmasinya sebelum QC diputuskan", 409, "QC_CORNER_NOT_CONFIRMED");
    }
    const process = phaseOf(run, "PROCESS");
    if (run.status !== "ACTIVE" || run.currentPhase !== "QC" || process?.status !== "COMPLETED" || phaseOf(run, "QC")?.status !== "NOT_STARTED" || activeOperation(run)) {
      throw qcError("Inspeksi QC hanya untuk run yang sedang menunggu QC (semua tahap sebelum gerbang selesai)", 409, "QC_NOT_AWAITING", { currentPhase: run.currentPhase, status: run.status });
    }
    const path = await pathForUnit(tx, run.unit);
    const { qcStage } = workshopPathOf(path);
    if (run.unit.currentStageId !== qcStage.id) throw qcError("Unit tidak berada di gerbang QC pada ledger tahap", 409, "QC_GATE_MISMATCH");

    // Fase 4 (LAYANAN, Run V2, bukan adaptasi): putusan SESUAI (PASS) hanya setelah PIC QC mencatat uji kasur jadi untuk putaran perakitan ini. FAIL (rework) dan WAIVED (kewenangan khusus) tidak diblokir.
    if (data.result === "PASS" && hasAssemblyGate(run) && !isAdaptationRun(run) && run.unit.order?.category === "LAYANAN") {
      const facts = await loadAssemblyGateFactsForRun(tx, run);
      if (facts.hasFoundation && !facts.foundationTestAfter?.ok) throw qcError("Uji fondasi baru belum dicatat PIC QC untuk putaran ini — catat dulu sebelum memutuskan Lulus", 409, "QC_FOUNDATION_NEW_TEST_REQUIRED");
      if (!facts.after?.ok) throw qcError("Hasil aktual susunan belum dicatat untuk putaran ini — PIC Meja perlu mencatatnya sebelum Lulus", 409, "QC_AFTER_REQUIRED");
      if (!facts.wholeTestAfter?.ok) throw qcError("Uji kasur jadi belum dicatat PIC QC untuk putaran ini — catat dulu di Aplikasi PIC QC sebelum memutuskan Sesuai", 409, "QC_FINISHED_TEST_REQUIRED");
    }

    const now = new Date();
    const command = await beginCommand(tx, { actor, idempotencyKey, commandType: "RECORD_QC", aggregateId: runId, requestHash, expectedRevision: revisionExpected });
    const version = (run.inspections[0]?.version ?? 0) + 1;

    // Proyeksi V1 (transaksi yang sama): PASS/FAIL -> START gerbang + putusan Uji Berat Badan (qc_fit_tests + ledger + currentStageId);
    // WAIVED -> SATU baris SKIP jujur di ledger, tanpa qc_fit_tests.
    let fit = null;
    let reworkStage = null;
    if (data.result === "WAIVED") {
      await viaEngine(() => waiveQcGateInTx(tx, run.unitId, qcStage.id, { actorId, note: data.reason }));
    } else {
      await viaEngine(() => startStageInTx(tx, run.unitId, { actorId }));
      fit = await viaEngine(() => recordQcFitTestInTx(tx, run.unitId, qcStage.id, {
        actorId, verdict: data.fitVerdict, referenceWeightKg: data.referenceWeightKg, customerPreferenceOverride: data.customerPreferenceOverride,
        educationGiven: data.educationGiven, note: data.note || null, photoUrls: data.photoUrls, reworkStageId: data.result === "FAIL" ? data.reworkStageId : null, deferReady: true,
        ...(data.generic ? { generic: true, genericPassed: data.result === "PASS" } : {}),
      }));
      if ((data.result === "PASS") !== (fit.result === "PASSED")) throw qcError("Hasil uji berat badan tidak konsisten dengan keputusan QC", 422, "QC_VERDICT_INVALID");
      reworkStage = fit.reworkStage ?? null;
    }

    const disposition = data.result === "PASS" ? "PASSED" : data.result === "FAIL" ? `REWORK:${reworkStage.code}` : "QC_WAIVED";
    const overall = { itemCode: "OVERALL", label: "Hasil QC keseluruhan", result: data.result, note: data.result === "WAIVED" ? data.reason : (data.note || null), photoUrls: data.photoUrls, sortOrder: 0 };
    const inspection = await tx.qualityInspection.create({
      data: {
        runId, version, checklistVersion: "qc-v1", result: RESULT_TO_DB[data.result], inspectorId: actorId || null, disposition,
        overrideReason: data.result === "WAIVED" ? data.reason : null, inspectedAt: now, qcFitTestId: fit?.test?.id ?? null,
        items: { create: [overall, ...data.items.map((item, index) => ({ ...item, sortOrder: index + 1 }))] },
      },
    });

    // Fase/run.
    let nextPhase;
    let handoff = null;
    if (data.result === "FAIL") {
      await transitionPhases(tx, runId, [{ phase: "PROCESS", data: { status: "ACTIVE", completedAt: null, reason: `Rework QC #${version}: ${reworkStage.labelId}` } }]);
      nextPhase = "PROCESS";
    } else {
      // QC ditutup dan fase berikutnya dibuka dalam SATU transisi atomik.
      const qcClosed = { phase: "QC", data: { status: "COMPLETED", startedAt: now, completedAt: now, reason: data.result === "WAIVED" ? `QC_WAIVED: ${data.reason}` : null } };
      const pathDone = await isUnitPathDoneInTx(tx, run.unitId);
      if (pathDone) {
        // Gerbang QC ternyata tahap terakhir jalur: langsung Handoff.
        await transitionPhases(tx, runId, [qcClosed, { phase: "HANDOFF", data: { status: "ACTIVE", startedAt: now, reason: null } }]);
        nextPhase = "HANDOFF";
      } else {
        await transitionPhases(tx, runId, [qcClosed, { phase: "PROCESS", data: { status: "ACTIVE", completedAt: null, reason: "Tahap setelah QC" } }]);
        nextPhase = "PROCESS";
      }
    }
    const revision = await bumpRun(tx, run, { currentPhase: nextPhase });
    if (nextPhase === "HANDOFF") handoff = await offerFinishedGoodsCustodyInTx(tx, { runId, actorId });

    // Bahan tambahan rework (hanya FAIL; jalur reservasi P3 + Material Issue P4).
    let supplementalIssue = null;
    if (data.result === "FAIL" && data.supplementalMaterials.length) {
      supplementalIssue = await openSupplementalMaterialInTx(tx, { run, inspectionId: inspection.id, lines: data.supplementalMaterials, actorId, commandId: command.id });
    }

    await outbox(tx, {
      eventType: "production.qc.recorded", aggregateId: runId, revision, dedupeKey: `production-qc-recorded:${runId}:${revision}`,
      payload: { runId, unitId: run.unitId, inspectionId: inspection.id, version, result: data.result, disposition, nextPhase, qcFitTestId: fit?.test?.id ?? null, revision, occurredAt: now.toISOString(), actorId },
    });
    if (data.result === "FAIL") {
      await outbox(tx, {
        eventType: "production.rework.opened", aggregateId: runId, revision, dedupeKey: `production-rework-opened:${runId}:${revision}`,
        payload: { runId, unitId: run.unitId, inspectionId: inspection.id, stageId: reworkStage.id, needsMaterial: Boolean(supplementalIssue), revision, occurredAt: now.toISOString(), actorId },
      });
    }
    await recordActivity(tx, {
      entityType: "unit", entityId: run.unitId, eventType: data.result === "WAIVED" ? EVENT_TYPES.PRODUCTION_QC_WAIVED : EVENT_TYPES.PRODUCTION_QC_RECORDED, actorId: actorId || null,
      metadata: { unitCode: run.unit.unitCode, runId, inspectionId: inspection.id, version, result: data.result, reason: data.result === "WAIVED" ? data.reason : null },
    });
    if (data.result === "FAIL") {
      await recordActivity(tx, {
        entityType: "unit", entityId: run.unitId, eventType: EVENT_TYPES.PRODUCTION_REWORK_OPENED, actorId: actorId || null,
        metadata: { unitCode: run.unit.unitCode, runId, inspectionId: inspection.id, stageLabel: reworkStage.labelId, note: data.note, needsMaterial: Boolean(supplementalIssue) },
      });
    }
    const response = {
      runId, revision, inspectionId: inspection.id, version, result: data.result, dbResult: RESULT_TO_DB[data.result], disposition, nextPhase,
      qcFitTestId: fit?.test?.id ?? null, ...(reworkStage ? { reworkStage: { id: reworkStage.id, code: reworkStage.code, label: reworkStage.labelId } } : {}),
      ...(supplementalIssue ? { supplementalIssue } : {}), ...(handoff ? { handoffId: handoff.handoff.id, qcBasis: handoff.qcBasis } : {}),
    };
    await finishCommand(tx, command, revision, response);
    return { replayed: false, ...response };
  });
}

// Bahan tambahan: reservasi baru (P3) + Material Issue baru READY_TO_PICK (P4) terhubung ke inspeksi. Plan sudah dikunci (withPlan).
async function openSupplementalMaterialInTx(tx, { run, inspectionId, lines, actorId, commandId }) {
  if (!run.plan) throw qcError("Production Run belum memiliki rencana; bahan tambahan tidak dapat diajukan", 409, "QC_NO_PLAN");
  const plan = await loadPlanForWrite(tx, run.plan.id);
  const { reservations } = await reserveSupplementalInTx(tx, { plan, inspectionId, lines, actorId, commandId });
  const issue = await createSupplementalIssueInTx(tx, { plan: { ...plan, revision: plan.revision + 1 }, inspectionId, reservations, actorId, commandId });
  return { ...issue, lines: reservations.map((r) => ({ materialId: r.materialId, qty: r.qty })) };
}

// Tambah bahan tambahan SETELAH FAIL tetapi SEBELUM rework dimulai (mis. stok baru tersedia / kebutuhan baru terlihat).
// `authorize` (opsional): dipanggil di dalam transaksi setelah run terkunci & revisi cocok — dipakai PIC Bahan per pekerjaan (aturan akses sendiri) tanpa membuat penulis permintaan bahan kedua.
export async function requestReworkMaterial(prisma, { runId, actorId, idempotencyKey, expectedRevision, lines, authorize = null }) {
  if (!runId) throw qcError("runId wajib diisi", 400, "QC_RUN_ID_REQUIRED");
  assertIdempotencyKey(idempotencyKey);
  const revisionExpected = assertExpectedRevision(expectedRevision);
  const normalized = (Array.isArray(lines) ? lines : []).map((l) => ({ materialId: l?.materialId, qty: Number(l?.qty) }));
  assertPlanBOMLines(normalized);
  const actor = actorId || "SYSTEM";
  const requestHash = hash({ commandType: "REQUEST_REWORK_MATERIAL", runId, expectedRevision: revisionExpected, lines: [...normalized].sort((a, b) => String(a.materialId).localeCompare(String(b.materialId))) });

  return prisma.$transaction(async (tx) => {
    const run = await loadRunLocked(tx, runId, { withPlan: true });
    const replay = await findReplay(tx, actor, idempotencyKey, requestHash);
    if (replay) return replay;
    await assertWriterEnabledForUnit(tx, run.unitId);
    assertRunOpen(run);
    assertRunConsistent(run, run.unit);
    await assertNoOpenRunException(tx, run.id);
    assertRunRevision(run, revisionExpected);
    if (authorize) await authorize(tx, run);
    const latest = run.inspections[0];
    if (!latest || latest.result !== "FAIL_REWORK" || run.currentPhase !== "PROCESS" || activeOperation(run)) {
      throw qcError("Bahan tambahan hanya dapat diajukan untuk rework yang belum dimulai (setelah QC FAIL)", 409, "QC_NOT_IN_REWORK");
    }
    if (run.operations.some((op) => op.createdAt > latest.inspectedAt)) throw qcError("Rework sudah dimulai; bahan tambahan tidak dapat diajukan lagi", 409, "QC_REWORK_ALREADY_STARTED");
    const existing = await tx.materialIssue.findFirst({ where: { reworkInspectionId: latest.id, status: { not: "CANCELLED" } }, select: { id: true } });
    if (existing) throw qcError("Bahan tambahan untuk inspeksi ini sudah diajukan", 409, "QC_REWORK_MATERIAL_EXISTS", { issueId: existing.id });

    const now = new Date();
    const command = await beginCommand(tx, { actor, idempotencyKey, commandType: "REQUEST_REWORK_MATERIAL", aggregateId: runId, requestHash, expectedRevision: revisionExpected });
    const issue = await openSupplementalMaterialInTx(tx, { run, inspectionId: latest.id, lines: normalized, actorId, commandId: command.id });
    const revision = await bumpRun(tx, run);
    await outbox(tx, {
      eventType: "production.rework.material_requested", aggregateId: runId, revision, dedupeKey: `production-rework-material:${runId}:${revision}`,
      payload: { runId, unitId: run.unitId, inspectionId: latest.id, issueId: issue.issueId, revision, occurredAt: now.toISOString(), actorId },
    });
    const response = { runId, revision, inspectionId: latest.id, supplementalIssue: issue };
    await finishCommand(tx, command, revision, response);
    return { replayed: false, ...response };
  });
}

// ---------------------------------------------------------------------------
// 2. Tindak lanjut penolakan Gudang atas barang jadi: TAWARKAN ULANG atau REWORK (kembali ke QC).
// ---------------------------------------------------------------------------
export async function resolveHandoffRejection(prisma, { runId, actorId, idempotencyKey, expectedRevision, action, note, reworkStageId = null }) {
  if (!runId) throw qcError("runId wajib diisi", 400, "QC_RUN_ID_REQUIRED");
  assertIdempotencyKey(idempotencyKey);
  const revisionExpected = assertExpectedRevision(expectedRevision);
  const act = String(action ?? "").toUpperCase();
  if (!["REOFFER", "REWORK"].includes(act)) throw qcError("Tindakan harus REOFFER (tawarkan ulang) atau REWORK", 400, "QC_HANDOFF_ACTION_INVALID");
  const cleaned = String(note ?? "").trim();
  if (cleaned.length < 3) throw qcError("Catatan tindakan koreksi wajib diisi (minimal 3 karakter)", 400, "QC_NOTE_REQUIRED");
  if (act === "REWORK" && !reworkStageId) throw qcError("Tahap rework wajib ditentukan secara eksplisit", 400, "QC_REWORK_STAGE_REQUIRED");
  const actor = actorId || "SYSTEM";
  const requestHash = hash({ commandType: "RESOLVE_HANDOFF_REJECTION", runId, expectedRevision: revisionExpected, action: act, note: cleaned, reworkStageId });

  return prisma.$transaction(async (tx) => {
    const run = await loadRunLocked(tx, runId);
    const replay = await findReplay(tx, actor, idempotencyKey, requestHash);
    if (replay) return replay;
    await assertWriterEnabledForUnit(tx, run.unitId);
    assertRunOpen(run);
    assertRunConsistent(run, run.unit);
    await assertNoOpenRunException(tx, run.id);
    assertRunRevision(run, revisionExpected);
    const handoffPhase = phaseOf(run, "HANDOFF");
    const latestHandoff = await tx.unitCustodyHandoff.findFirst({ where: { productionRunId: runId, direction: "FINISHED_GOODS" }, orderBy: [{ offeredAt: "desc" }, { id: "desc" }] });
    const waitingOrDone = latestHandoff && ["OFFERED", "ACCEPTED"].includes(latestHandoff.status);
    if (run.status !== "ACTIVE" || run.currentPhase !== "HANDOFF" || !latestHandoff || waitingOrDone || !["BLOCKED", "ACTIVE"].includes(handoffPhase?.status ?? "")) {
      throw qcError("Tidak ada penolakan Gudang yang perlu ditindaklanjuti untuk run ini", 409, "QC_NO_REJECTION", { currentPhase: run.currentPhase });
    }

    const now = new Date();
    const command = await beginCommand(tx, { actor, idempotencyKey, commandType: "RESOLVE_HANDOFF_REJECTION", aggregateId: runId, requestHash, expectedRevision: revisionExpected });
    let revision;
    let handoff = null;
    let reworkStage = null;
    if (act === "REOFFER") {
      await transitionPhases(tx, runId, [{ phase: "HANDOFF", data: { status: "ACTIVE", reason: null } }]);
      revision = await bumpRun(tx, run);
      handoff = await offerFinishedGoodsCustodyInTx(tx, { runId, actorId });
    } else {
      reworkStage = await viaEngine(() => reopenStageBeforeQcInTx(tx, run.unitId, reworkStageId));
      await transitionPhases(tx, runId, [
        { phase: "HANDOFF", data: { status: "NOT_STARTED", startedAt: null, completedAt: null, reason: `Rework setelah penolakan Gudang: ${cleaned}` } },
        { phase: "QC", data: { status: "NOT_STARTED", startedAt: null, completedAt: null, reason: null } },
        { phase: "PROCESS", data: { status: "ACTIVE", completedAt: null, reason: `Rework setelah penolakan Gudang: ${reworkStage.labelId}` } },
      ]);
      revision = await bumpRun(tx, run, { currentPhase: "PROCESS" });
    }
    await outbox(tx, {
      eventType: "production.handoff.resolved", aggregateId: runId, revision, dedupeKey: `production-handoff-resolved:${runId}:${revision}`,
      payload: { runId, unitId: run.unitId, action: act, note: cleaned, stageId: reworkStage?.id ?? null, handoffId: handoff?.handoff.id ?? null, revision, occurredAt: now.toISOString(), actorId },
    });
    await recordActivity(tx, {
      entityType: "unit", entityId: run.unitId, eventType: EVENT_TYPES.PRODUCTION_HANDOFF_ACTION, actorId: actorId || null,
      metadata: { unitCode: run.unit.unitCode, runId, action: act, note: cleaned, stageLabel: reworkStage?.labelId ?? null },
    });
    const response = { runId, revision, action: act, nextPhase: act === "REOFFER" ? "HANDOFF" : "PROCESS", ...(handoff ? { handoffId: handoff.handoff.id } : {}), ...(reworkStage ? { reworkStage: { id: reworkStage.id, label: reworkStage.labelId } } : {}) };
    await finishCommand(tx, command, revision, response);
    return { replayed: false, ...response };
  });
}

// ---------------------------------------------------------------------------
// 3. Batalkan Production Run (Production Lead) — prasyarat pembatalan order dari V1 untuk unit cohort.
// ---------------------------------------------------------------------------
async function lockFinishedGoodsHandoffs(tx, unitId) {
  const rows = await tx.unitCustodyHandoff.findMany({ where: { unitId, direction: "FINISHED_GOODS", status: "OFFERED" }, select: { id: true }, orderBy: { id: "asc" } });
  for (const row of rows) await lockRowForUpdate(tx, "unit_custody_handoffs_v2", row.id);
}

// Urutan kunci: handoff barang jadi (yang mungkin sedang diputuskan Gudang: handoff -> unit -> run) -> unit -> run.
async function loadRunLockedWithHandoffs(tx, runId) {
  const pre = await tx.productionRun.findUnique({ where: { id: runId }, select: { unitId: true } });
  if (!pre) throw qcError("Production Run tidak ditemukan", 404, "QC_RUN_NOT_FOUND");
  await lockFinishedGoodsHandoffs(tx, pre.unitId);
  return loadRunLocked(tx, runId);
}

async function cancelRunInTx(tx, { run, actor, reason, now }) {
  for (const op of run.operations.filter((o) => o.status === "ACTIVE" || o.status === "PAUSED")) {
    await tx.productionOperationRun.update({ where: { id: op.id }, data: { status: "SKIPPED", completedAt: now } });
  }
  const openPhases = run.phases.filter((p) => !["COMPLETED", "NOT_APPLICABLE", "CANCELLED"].includes(p.status));
  if (openPhases.length) await transitionPhases(tx, run.id, openPhases.map((phase) => ({ phase: phase.phase, data: { status: "CANCELLED", reason: `Run dibatalkan: ${reason}` } })));
  const cancelledHandoffs = await cancelOfferedFinishedGoodsCustodyInTx(tx, { unitId: run.unitId, actor, reason });
  const revision = run.revision + 1;
  await tx.productionRun.update({ where: { id: run.id }, data: { status: "CANCELLED", completedAt: now, revision } });
  await outbox(tx, {
    eventType: "production.run.cancelled", aggregateId: run.id, revision, dedupeKey: `production-run-cancelled:${run.id}:${revision}`,
    payload: { runId: run.id, unitId: run.unitId, reason, cancelledHandoffs, revision, occurredAt: now.toISOString(), actorId: actor },
  });
  await recordActivity(tx, {
    entityType: "unit", entityId: run.unitId, eventType: EVENT_TYPES.PRODUCTION_RUN_CANCELLED, actorId: actor,
    metadata: { unitCode: run.unit.unitCode, runId: run.id, reason },
  });
  return revision;
}

export async function cancelProductionRun(prisma, { runId, actorId, idempotencyKey, expectedRevision, reason }) {
  if (!runId) throw qcError("runId wajib diisi", 400, "QC_RUN_ID_REQUIRED");
  assertIdempotencyKey(idempotencyKey);
  const revisionExpected = assertExpectedRevision(expectedRevision);
  const cleaned = String(reason ?? "").trim();
  if (cleaned.length < 3) throw qcError("Alasan pembatalan run wajib diisi (minimal 3 karakter)", 400, "QC_REASON_REQUIRED");
  const actor = actorId || "SYSTEM";
  const requestHash = hash({ commandType: "CANCEL_RUN", runId, expectedRevision: revisionExpected, reason: cleaned });

  return prisma.$transaction(async (tx) => {
    const run = await loadRunLockedWithHandoffs(tx, runId);
    const replay = await findReplay(tx, actor, idempotencyKey, requestHash);
    if (replay) return replay;
    await assertWriterEnabledForUnit(tx, run.unitId);
    assertRunOpen(run);
    assertRunRevision(run, revisionExpected);
    const now = new Date();
    const command = await beginCommand(tx, { actor, idempotencyKey, commandType: "CANCEL_RUN", aggregateId: runId, requestHash, expectedRevision: revisionExpected });
    const revision = await cancelRunInTx(tx, { run, actor, reason: cleaned, now });
    // Exception OPEN (mis. unit sudah dibatalkan di V1) ikut selesai: pembatalan run ADALAH resolusinya.
    const open = await tx.productionRunException.findFirst({ where: { runId, status: "OPEN" } });
    if (open) {
      await tx.productionRunException.update({
        where: { id: open.id },
        data: { status: "RESOLVED", resolution: "CANCEL_RUN", resolutionNote: cleaned, resolvedById: actorId || null, resolvedAt: now, revision: open.revision + 1, commandId: command.id },
      });
    }
    const response = { runId, revision, status: "CANCELLED", resolvedExceptionId: open?.id ?? null };
    await finishCommand(tx, command, revision, response);
    return { replayed: false, ...response };
  });
}

// ---------------------------------------------------------------------------
// 4. Rekonsiliasi override V1: catat konflik (server-derived), sapu cohort, dan selesaikan lewat resolusi eksplisit.
// ---------------------------------------------------------------------------
async function openExceptionInTx(tx, { run, actor, now }) {
  const found = detectRunInconsistency({ run, unit: run.unit });
  if (!found) return { exception: null, created: false, reason: "CONSISTENT" };
  const existing = await tx.productionRunException.findFirst({ where: { runId: run.id, status: "OPEN" } });
  if (existing) return { exception: existing, created: false, reason: "ALREADY_OPEN" };
  const exception = await tx.productionRunException.create({
    data: {
      runId: run.id, unitId: run.unitId, kind: found.kind, status: "OPEN", unitStatusSeen: found.unitStatus, runPhaseSeen: found.runPhase, runRevisionSeen: found.runRevision,
      evidence: { unitStatus: found.unitStatus, runStatus: run.status, runPhase: found.runPhase, runRevision: found.runRevision, unitCurrentStageId: run.unit.currentStageId ?? null, detectedAt: now.toISOString() },
      detectedById: actor === "SYSTEM" ? null : actor,
    },
  });
  await outbox(tx, {
    eventType: "production.run.exception_opened", aggregateId: run.id, revision: run.revision, dedupeKey: `production-run-exception-opened:${exception.id}`,
    payload: { runId: run.id, unitId: run.unitId, exceptionId: exception.id, kind: found.kind, unitStatus: found.unitStatus, occurredAt: now.toISOString(), actorId: actor },
  });
  await recordActivity(tx, {
    entityType: "unit", entityId: run.unitId, eventType: EVENT_TYPES.PRODUCTION_RUN_EXCEPTION_OPENED, actorId: actor === "SYSTEM" ? null : actor,
    metadata: { unitCode: run.unit.unitCode, runId: run.id, exceptionId: exception.id, kind: found.kind, unitStatus: found.unitStatus },
  });
  return { exception, created: true, reason: "OPENED" };
}

export async function openRunException(prisma, { runId, actorId, idempotencyKey }) {
  if (!runId) throw qcError("runId wajib diisi", 400, "QC_RUN_ID_REQUIRED");
  assertIdempotencyKey(idempotencyKey);
  const actor = actorId || "SYSTEM";
  const requestHash = hash({ commandType: "OPEN_RUN_EXCEPTION", runId });
  return prisma.$transaction(async (tx) => {
    const run = await loadRunLocked(tx, runId);
    const replay = await findReplay(tx, actor, idempotencyKey, requestHash);
    if (replay) return replay;
    await assertWriterEnabledForUnit(tx, run.unitId);
    const now = new Date();
    const command = await beginCommand(tx, { actor, idempotencyKey, commandType: "OPEN_RUN_EXCEPTION", aggregateId: runId, requestHash });
    const outcome = await openExceptionInTx(tx, { run, actor, now });
    if (!outcome.exception) {
      // Tidak ada konflik: tidak ada yang dicatat (server yang menentukan, bukan klien).
      throw qcError("Status unit konsisten dengan Production Run; tidak ada konflik yang perlu dicatat", 409, "QC_RUN_CONSISTENT");
    }
    const response = { runId, exceptionId: outcome.exception.id, kind: outcome.exception.kind, status: outcome.exception.status, revision: outcome.exception.revision, alreadyOpen: !outcome.created };
    await finishCommand(tx, command, outcome.exception.revision, response);
    return { replayed: false, ...response };
  });
}

// Sapu cohort: catat konflik untuk semua run aktif yang tidak konsisten (dibatasi 50 per panggilan; urutan kunci ascending unitId).
export async function sweepRunExceptions(prisma, { actorId, idempotencyKey, limit = 50 }) {
  assertIdempotencyKey(idempotencyKey);
  const actor = actorId || "SYSTEM";
  const take = Math.min(Math.max(Number(limit) || 50, 1), 50);
  const requestHash = hash({ commandType: "SWEEP_RUN_EXCEPTIONS", limit: take });
  return prisma.$transaction(async (tx) => {
    const replay = await findReplay(tx, actor, idempotencyKey, requestHash);
    if (replay) return replay;
    const state = resolveProductionWriterState(await loadV2Flags(tx));
    const candidates = await tx.productionRun.findMany({
      where: { status: { in: [...RUN_OWNED_STATUSES] }, unit: { status: { in: ["CANCELLED", "READY_FOR_DELIVERY", "READY_ON_CUSTOMER_HOLD", "IN_TRANSIT_OUT", "DELIVERED"] } }, exceptions: { none: { status: "OPEN" } } },
      select: { id: true, unitId: true }, orderBy: [{ unitId: "asc" }, { id: "asc" }], take: take * 2,
    });
    const targets = candidates.filter((c) => isProductionWriterEnabledFor(state, c.unitId)).slice(0, take);
    const now = new Date();
    const command = await beginCommand(tx, { actor, idempotencyKey, commandType: "SWEEP_RUN_EXCEPTIONS", aggregateId: idempotencyKey, requestHash });
    const opened = [];
    for (const target of targets) {
      const run = await loadRunLocked(tx, target.id);
      const outcome = await openExceptionInTx(tx, { run, actor, now });
      if (outcome.created) opened.push({ runId: run.id, exceptionId: outcome.exception.id, kind: outcome.exception.kind });
    }
    const response = { scanned: targets.length, openedCount: opened.length, opened };
    await finishCommand(tx, command, opened.length, response);
    return { replayed: false, ...response };
  });
}

export async function resolveRunException(prisma, { exceptionId, actorId, canWaive = false, idempotencyKey, expectedRevision, resolution, note }) {
  if (!exceptionId) throw qcError("exceptionId wajib diisi", 400, "QC_EXCEPTION_ID_REQUIRED");
  assertIdempotencyKey(idempotencyKey);
  const revisionExpected = assertExpectedRevision(expectedRevision);
  const chosen = String(resolution ?? "").toUpperCase();
  if (!["RESTORE_UNIT_STATUS", "CANCEL_RUN", "ACCEPT_OVERRIDE", "NO_LONGER_APPLICABLE"].includes(chosen)) throw qcError("Resolusi tidak dikenal", 400, "QC_RESOLUTION_INVALID");
  const cleaned = String(note ?? "").trim();
  if (cleaned.length < 3) throw qcError("Catatan resolusi wajib diisi (minimal 3 karakter)", 400, "QC_NOTE_REQUIRED");
  if (chosen === "ACCEPT_OVERRIDE" && !canWaive) throw qcError("Menerima override V1 memerlukan otoritas QC_WAIVE", 403, "QC_WAIVE_FORBIDDEN");
  const actor = actorId || "SYSTEM";
  const requestHash = hash({ commandType: "RESOLVE_RUN_EXCEPTION", exceptionId, expectedRevision: revisionExpected, resolution: chosen, note: cleaned });

  return prisma.$transaction(async (tx) => {
    const pre = await tx.productionRunException.findUnique({ where: { id: exceptionId }, select: { runId: true } });
    if (!pre) throw qcError("Konflik tidak ditemukan", 404, "QC_EXCEPTION_NOT_FOUND");
    const run = await loadRunLockedWithHandoffs(tx, pre.runId);
    const replay = await findReplay(tx, actor, idempotencyKey, requestHash);
    if (replay) return replay;
    await assertWriterEnabledForUnit(tx, run.unitId);
    await lockRowForUpdate(tx, "production_run_exceptions_v2", exceptionId);
    const exception = await tx.productionRunException.findUnique({ where: { id: exceptionId } });
    if (exception.status !== "OPEN") throw qcError("Konflik ini sudah diselesaikan", 409, "QC_EXCEPTION_NOT_OPEN", { status: exception.status });
    if (exception.revision !== revisionExpected) throw qcError(`Revisi konflik berubah: diharapkan ${revisionExpected}, sekarang ${exception.revision}. Muat ulang.`, 409, "QC_EXCEPTION_REVISION_CONFLICT", { revision: exception.revision });
    assertRunOpen(run);

    const found = detectRunInconsistency({ run, unit: run.unit });
    if (!found && chosen !== "NO_LONGER_APPLICABLE") throw qcError("Status unit sudah konsisten lagi — resolusi yang sesuai: NO_LONGER_APPLICABLE", 409, "QC_RESOLUTION_NOT_ALLOWED");
    if (found && chosen === "NO_LONGER_APPLICABLE") throw qcError("Konflik masih berlaku; pilih resolusi lain", 409, "QC_RESOLUTION_NOT_ALLOWED");
    if (found && !ALLOWED_RESOLUTIONS[found.kind].includes(chosen)) {
      throw qcError(`Resolusi ${chosen} tidak berlaku untuk konflik ${found.kind}`, 409, "QC_RESOLUTION_NOT_ALLOWED", { allowed: ALLOWED_RESOLUTIONS[found.kind] });
    }

    const now = new Date();
    const command = await beginCommand(tx, { actor, idempotencyKey, commandType: "RESOLVE_RUN_EXCEPTION", aggregateId: run.id, requestHash, expectedRevision: revisionExpected });
    let runRevision = run.revision;
    let unitStatus = run.unit.status;
    if (chosen === "RESTORE_UNIT_STATUS") {
      unitStatus = await viaEngine(() => restoreUnitStatusInTx(tx, run.unitId));
      runRevision = await bumpRun(tx, run);
    } else if (chosen === "CANCEL_RUN") {
      runRevision = await cancelRunInTx(tx, { run, actor, reason: `Rekonsiliasi override V1: ${cleaned}`, now });
    } else if (chosen === "ACCEPT_OVERRIDE") {
      // Override diterima apa adanya: run ditutup TANPA bukti QC/custody (tidak ada inspeksi/handoff dikarang) dan ditandai jelas.
      for (const op of run.operations.filter((o) => o.status === "ACTIVE" || o.status === "PAUSED")) {
        await tx.productionOperationRun.update({ where: { id: op.id }, data: { status: "SKIPPED", completedAt: now } });
      }
      const openPhases = run.phases.filter((p) => !["COMPLETED", "NOT_APPLICABLE", "CANCELLED"].includes(p.status));
      if (openPhases.length) await transitionPhases(tx, run.id, openPhases.map((phase) => ({ phase: phase.phase, data: { status: "NOT_APPLICABLE", reason: `Ditutup lewat override manual V1 (bukan hasil QC/custody): ${cleaned}` } })));
      // Penutupan override eksplisit: seluruh fase terminal, HANDOFF boleh NOT_APPLICABLE (tanpa bukti custody yang dikarang).
      await assertRunPhasesTerminal(tx, run.id, { requireHandoffCompleted: false });
      await cancelOfferedFinishedGoodsCustodyInTx(tx, { unitId: run.unitId, actor, reason: `Run ditutup lewat override V1: ${cleaned}` });
      runRevision = run.revision + 1;
      await tx.productionRun.update({ where: { id: run.id }, data: { status: "COMPLETED", completedAt: now, revision: runRevision } });
      await recordActivity(tx, {
        entityType: "unit", entityId: run.unitId, eventType: EVENT_TYPES.PRODUCTION_RUN_COMPLETED, actorId: actorId || null,
        metadata: { unitCode: run.unit.unitCode, runId: run.id, closedByOverride: true },
      });
    }
    const revision = exception.revision + 1;
    await tx.productionRunException.update({
      where: { id: exception.id },
      data: { status: "RESOLVED", resolution: chosen, resolutionNote: cleaned, resolvedById: actorId || null, resolvedAt: now, revision, commandId: command.id },
    });
    await outbox(tx, {
      eventType: "production.run.exception_resolved", aggregateId: run.id, revision: runRevision, dedupeKey: `production-run-exception-resolved:${exception.id}:${revision}`,
      payload: { runId: run.id, unitId: run.unitId, exceptionId: exception.id, resolution: chosen, unitStatus, runRevision, occurredAt: now.toISOString(), actorId },
    });
    await recordActivity(tx, {
      entityType: "unit", entityId: run.unitId, eventType: EVENT_TYPES.PRODUCTION_RUN_EXCEPTION_RESOLVED, actorId: actorId || null,
      metadata: { unitCode: run.unit.unitCode, runId: run.id, exceptionId: exception.id, resolution: chosen, note: cleaned },
    });
    const response = { exceptionId: exception.id, runId: run.id, resolution: chosen, revision, runRevision, unitStatus, runStatus: chosen === "CANCEL_RUN" ? "CANCELLED" : chosen === "ACCEPT_OVERRIDE" ? "COMPLETED" : run.status };
    await finishCommand(tx, command, revision, response);
    return { replayed: false, ...response };
  });
}

// ---------------------------------------------------------------------------
// Bacaan (digerbang flag reader di layer routes).
// ---------------------------------------------------------------------------
const QC_TABS = Object.freeze(["AWAITING_QC", "REWORK", "HANDOFF", "REJECTED", "CONFLICT"]);
export const QC_QUEUE_TABS = QC_TABS;

function stateOf(run) {
  const handoff = phaseOf(run, "HANDOFF");
  const process = phaseOf(run, "PROCESS");
  if (run.exceptions?.some((e) => e.status === "OPEN") || detectRunInconsistency({ run, unit: run.unit })) return "CONFLICT";
  if (handoff?.status === "BLOCKED") return "REJECTED";
  if (run.currentPhase === "HANDOFF") return "HANDOFF";
  if (run.currentPhase === "QC" && process?.status === "COMPLETED") return "AWAITING_QC";
  if (run.currentPhase === "PROCESS" && run.inspections?.[0]?.result === "FAIL_REWORK") return "REWORK";
  return "OTHER";
}

export async function listQcQueue(prisma, { tab = "AWAITING_QC", unitIds = null, limit = 100 } = {}) {
  if (!QC_TABS.includes(tab)) throw qcError("Tab antrean tidak valid", 400, "QC_TAB_INVALID");
  const runs = await prisma.productionRun.findMany({
    where: { status: { notIn: [...RUN_TERMINAL_STATUSES] }, ...(unitIds ? { unitId: { in: unitIds } } : {}), phases: { some: { phase: "PROCESS", status: { in: ["COMPLETED", "ACTIVE"] } } } },
    include: {
      unit: { select: { id: true, unitCode: true, status: true, order: { select: { orderNumber: true, category: true } } } },
      phases: true, inspections: { orderBy: { version: "desc" }, take: 1 }, exceptions: { where: { status: "OPEN" }, select: { id: true, kind: true, status: true } },
      plan: { select: { workCenter: { select: { id: true, name: true } }, operator: { select: { id: true, user: { select: { name: true } } } } } },
    },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }], take: 200,
  });
  const selected = runs
    .map((run) => ({ run, state: stateOf(run) }))
    .filter(({ state }) => state === tab)
    .slice(0, Math.min(Math.max(Number(limit) || 100, 1), 200));
  const builds = await buildTrackUnits(prisma, selected.map(({ run }) => run.unitId));
  return selected
    .map(({ run, state }) => ({
      runId: run.id, revision: run.revision, state, origin: run.origin, currentPhase: run.currentPhase,
      // Jalur pengerjaan (BARU/custom): profil QC dari jenis produk kanonis — KASUR (uji berat badan) atau GENERIC (pemeriksaan hasil divan/sofa, tanpa uji berat badan).
      track: builds.has(run.unitId) ? "BUILD" : "RESTORATION", qcProfile: qcProfileOf(builds.get(run.unitId)), productClass: builds.get(run.unitId)?.productClass ?? null, productClassProblem: builds.get(run.unitId)?.problem ?? null, cornerRequired: builds.get(run.unitId)?.cornerRequired ?? null,
      unit: { id: run.unit.id, unitCode: run.unit.unitCode, status: run.unit.status, orderNumber: run.unit.order?.orderNumber ?? null, category: run.unit.order?.category ?? null },
      workCenter: run.plan?.workCenter ?? null, operator: run.plan?.operator ? { id: run.plan.operator.id, name: run.plan.operator.user?.name ?? null } : null,
      lastInspection: run.inspections[0] ? { version: run.inspections[0].version, result: run.inspections[0].result, disposition: run.inspections[0].disposition, inspectedAt: run.inspections[0].inspectedAt } : null,
      conflict: run.exceptions[0] ? { exceptionId: run.exceptions[0].id, kind: run.exceptions[0].kind, open: true } : (() => { const found = detectRunInconsistency({ run, unit: run.unit }); return found ? { exceptionId: null, kind: found.kind, open: false } : null; })(),
    }));
}

export async function getQcRun(prisma, runId) {
  const base = await getWorkshopRun(prisma, runId);
  if (!base) return null;
  const run = await prisma.productionRun.findUnique({
    where: { id: runId },
    include: {
      inspections: { orderBy: { version: "asc" }, include: { items: { orderBy: { sortOrder: "asc" } } } },
      exceptions: { orderBy: { detectedAt: "desc" } },
      phases: true, unit: { select: { id: true, unitCode: true, status: true } },
    },
  });
  const inspectorIds = [...new Set(run.inspections.map((i) => i.inspectorId).filter(Boolean))];
  const inspectors = inspectorIds.length ? await prisma.user.findMany({ where: { id: { in: inspectorIds } }, select: { id: true, name: true } }) : [];
  const nameById = new Map(inspectors.map((u) => [u.id, u.name]));
  const handoffs = await prisma.unitCustodyHandoff.findMany({
    where: { productionRunId: runId, direction: "FINISHED_GOODS" }, orderBy: [{ offeredAt: "asc" }, { id: "asc" }],
    include: { location: { select: { id: true, code: true } } },
  });
  const supplemental = await prisma.materialIssue.findMany({
    where: { reworkInspectionId: { in: run.inspections.map((i) => i.id) } }, orderBy: { createdAt: "asc" },
    include: { lines: { include: { material: { select: { code: true, name: true } } } } },
  });
  const found = detectRunInconsistency({ run, unit: run.unit });
  const conflictOpen = run.exceptions.find((e) => e.status === "OPEN") || null;
  const build = (await buildTrackUnits(prisma, [run.unitId])).get(run.unitId) ?? null;
  const buildSummary = build ? await loadBuildSummary(prisma, runId) : null;
  const orderSpec = build ? await prisma.order.findFirst({ where: { units: { some: { id: run.unitId } } }, select: { notes: true, productType: true, items: { select: { layananName: true }, orderBy: { sortOrder: "asc" } } } }) : null;
  return {
    ...base, state: stateOf({ ...run, exceptions: run.exceptions }),
    track: build ? "BUILD" : "RESTORATION", qcProfile: qcProfileOf(build), productClass: build?.productClass ?? null, productClassProblem: build?.problem ?? null, cornerRequired: build?.cornerRequired ?? null, cornerReason: build?.cornerReason ?? null,
    ...(build ? { racikan: buildSummary?.racikan ?? null, buildNote: buildSummary?.note ?? null, salesServices: (orderSpec?.items || []).map((i) => i.layananName), salesNotes: orderSpec?.notes ?? null } : {}),
    inspections: run.inspections.map((i) => ({
      id: i.id, version: i.version, result: i.result, disposition: i.disposition, overrideReason: i.overrideReason, inspectedAt: i.inspectedAt, inspector: nameById.get(i.inspectorId) ?? null, qcFitTestId: i.qcFitTestId,
      items: i.items.map((item) => ({ itemCode: item.itemCode, label: item.label, result: item.result, note: item.note, photoUrls: item.photoUrls })),
    })),
    handoffs: handoffs.map((h) => ({ id: h.id, status: h.status, revision: h.revision, offeredAt: h.offeredAt, acceptedAt: h.acceptedAt, rejectedAt: h.rejectedAt, reason: h.reason, location: h.location })),
    supplementalIssues: supplemental.map((s) => ({ id: s.id, issueNumber: s.issueNumber, status: s.status, revision: s.revision, inspectionId: s.reworkInspectionId, lines: s.lines.map((l) => ({ code: l.material.code, name: l.material.name, qty: l.requestedQty })) })),
    conflict: found || conflictOpen ? { detected: found, exception: conflictOpen ? { id: conflictOpen.id, kind: conflictOpen.kind, revision: conflictOpen.revision, detectedAt: conflictOpen.detectedAt, allowedResolutions: ALLOWED_RESOLUTIONS[conflictOpen.kind] ?? [] } : null } : null,
  };
}

export async function listRunExceptions(prisma, { status = "OPEN", unitIds = null, limit = 100 } = {}) {
  const rows = await prisma.productionRunException.findMany({
    where: { ...(status ? { status } : {}), ...(unitIds ? { unitId: { in: unitIds } } : {}) },
    include: { unit: { select: { unitCode: true, status: true } }, run: { select: { id: true, status: true, currentPhase: true, revision: true } } },
    orderBy: [{ detectedAt: "desc" }, { id: "desc" }], take: Math.min(Math.max(Number(limit) || 100, 1), 200),
  });
  return rows.map((row) => ({
    id: row.id, revision: row.revision, status: row.status, kind: row.kind, unitStatusSeen: row.unitStatusSeen, detectedAt: row.detectedAt, resolution: row.resolution, resolutionNote: row.resolutionNote, resolvedAt: row.resolvedAt,
    unit: { unitCode: row.unit.unitCode, status: row.unit.status }, run: { id: row.run.id, status: row.run.status, currentPhase: row.run.currentPhase, revision: row.run.revision },
    allowedResolutions: row.status === "OPEN" ? ALLOWED_RESOLUTIONS[row.kind] ?? [] : [],
  }));
}
