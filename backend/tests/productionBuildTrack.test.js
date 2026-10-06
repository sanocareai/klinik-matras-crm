import assert from "node:assert/strict";
import test from "node:test";
import { BUILD_CATEGORIES, BUILD_NA_STEPS, BUILD_STAGE_CODE, BUILD_STAGE_LABEL, isBuildTrack, pathHasBuildStage, stepLabelFor } from "../src/lib/domain/productionBuildTrack.js";
import { STEPS, deriveNextAction, stepNoForStage, validateStepEvidence } from "../src/lib/domain/productionSteps.js";
import { applicableStepsFor } from "../src/services/productionStepCommandService.js";
import { stepStatuses, indicatorsOf } from "../src/services/productionExperienceReadService.js";
import { buildUnitPath } from "../src/lib/domain/routing.js";
import { workshopPathOf } from "../src/services/productionWorkshopExecutionCommandService.js";

const VID = `/media/production-evidence/${"b".repeat(40)}.mp4`;
const stage = (code, phase, sequence, over = {}) => ({ id: code, code, labelId: code, phase, sequence, active: true, isOptional: false, requiresQc: false, ...over });
const INTAKE = [stage("pre_teardown_test", "INTAKE", 10), stage("teardown", "INTAKE", 20), stage("foundation_test", "INTAKE", 30), stage("diagnosis", "INTAKE", 40)];
const FINISH = [stage("fit_test", "FINISH", 10, { requiresQc: true }), stage("corner_sewing", "FINISH", 20), stage("finished", "FINISH", 30)];
const BUILD = stage(BUILD_STAGE_CODE, "MODULE", 10);
const restoration = workshopPathOf(buildUnitPath(INTAKE, [stage("foundation_service", "MODULE", 10), stage("cover_replacement", "MODULE", 30)], FINISH));
const build = workshopPathOf(buildUnitPath([], [BUILD], FINISH));

const base = (over = {}) => ({
  runStatus: "ACTIVE", currentPhase: "PROCESS", unitStatus: "RECEIVED", handoffPhaseStatus: "NOT_STARTED", exceptionOpen: false,
  activeOp: null, target: null, opEvidence: [], step9SinceQc: false, openShortage: false, serviceSet: false, pathHasModules: true, materialReady: false,
  diagnosisManualMapped: false, diagnosisBomHasLines: false, buildTrack: true, ...over,
});

test("jalur ditentukan dari kategori kanonis + asal Run, bukan awalan nomor resi", () => {
  assert.deepEqual([...BUILD_CATEGORIES], ["BARU"]);
  assert.equal(isBuildTrack({ origin: "WORKSHOP_BORN", category: "BARU" }), true);
  assert.equal(isBuildTrack({ origin: "WORKSHOP_BORN", category: "SEWA" }), false, "SEWA tidak berubah");
  assert.equal(isBuildTrack({ origin: "WORKSHOP_BORN", category: "LAYANAN" }), false);
  assert.equal(isBuildTrack({ origin: "CUSTODY_PICKUP", category: "BARU" }), false, "Run pickup/histori lama tidak tersentuh");
  assert.equal(isBuildTrack({ origin: null, category: "BARU" }), false);
  assert.equal(isBuildTrack({ origin: "WORKSHOP_BORN", category: null }), false);
});

test("jalur pengerjaan: tanpa INTAKE/diagnosa/layanan; urutan = Pengerjaan Pesanan -> uji tekstur/QC -> Corner -> Finish", () => {
  assert.equal(pathHasBuildStage(build.stages), true);
  assert.equal(pathHasBuildStage(restoration.stages), false);
  assert.deepEqual(build.stages.map((s) => s.code), [BUILD_STAGE_CODE]);
  assert.equal(build.qcStage?.code, "fit_test");
  assert.deepEqual(build.postQcStages.map((s) => s.code), ["corner_sewing", "finished"]);
  assert.equal(stepNoForStage(BUILD), 6);
});

test("tahap berlaku: build = 6,8–12; tahap 1–5 dan 7 tidak berlaku; restorasi tidak berubah", () => {
  assert.deepEqual(applicableStepsFor(build), [6, 8, 9, 10, 11, 12]);
  assert.deepEqual(BUILD_NA_STEPS, [1, 2, 3, 4, 5, 7]);
  const restoreSteps = applicableStepsFor(restoration);
  assert.deepEqual(restoreSteps, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
});

test("label tahap 6 = Pengerjaan Pesanan hanya di jalur pengerjaan", () => {
  assert.equal(stepLabelFor(6, "Fondasi Baru", true), BUILD_STAGE_LABEL);
  assert.equal(stepLabelFor(6, "Fondasi Baru", false), "Fondasi Baru");
  assert.equal(stepLabelFor(8, "Uji Tekstur Akhir", true), "Uji Tekstur Akhir");
});

test("status tahap: tahap tidak berlaku = NA (bukan DONE/SKIPPED) + alasan; label tahap 6 diganti", () => {
  const next = deriveNextAction(base({ target: { code: BUILD_STAGE_CODE, phase: "MODULE", sequence: 10 } }));
  const steps = stepStatuses({ split: build, evidence: [], next, state: { buildTrack: true } });
  for (const n of BUILD_NA_STEPS) {
    const s = steps.find((x) => x.no === n);
    assert.equal(s.status, "NA", `tahap ${n}`);
    assert.ok(s.naReason, `alasan tahap ${n}`);
  }
  assert.equal(steps.find((x) => x.no === 6).label, BUILD_STAGE_LABEL);
  assert.equal(steps.find((x) => x.no === 6).status, "CURRENT");
  const old = stepStatuses({ split: restoration, evidence: [], next: { stepNo: 1, action: "START_WITH_EVIDENCE" }, state: { buildTrack: false } });
  assert.equal(old.find((x) => x.no === 6).label, STEPS.find((x) => x.no === 6).label);
  assert.ok(old.every((s) => s.status !== "NA" || !s.naReason));
});

test("derivasi: unit build langsung bisa DIKERJAKAN (START tahap 6) tanpa bahan, tanpa layanan, tanpa Diagnosis", () => {
  assert.deepEqual(deriveNextAction(base({ target: { code: BUILD_STAGE_CODE, phase: "MODULE", sequence: 10 } })), { actor: "TABLE", stepNo: 6, action: "START" });
  // restorasi dengan bahan belum siap tetap menunggu Gudang (tidak berubah)
  const wait = deriveNextAction(base({ buildTrack: false, target: { code: "foundation_service", phase: "MODULE", sequence: 10 } }));
  assert.equal(wait.action, "WAIT");
  assert.equal(wait.wait, "MATERIAL_NOT_READY");
});

test("derivasi: setelah mulai -> bukti tahap 6 -> uji tekstur (8) -> QC -> Kirim ke Corner -> Corner -> Finish", () => {
  const op = { stageCode: BUILD_STAGE_CODE, stagePhase: "MODULE", stageSequence: 10, status: "ACTIVE", isLastPreQc: true };
  assert.deepEqual(deriveNextAction(base({ activeOp: op })), { actor: "TABLE", stepNo: 6, action: "EVIDENCE", rework: false, lastVerdict: null });
  const ev6 = { stepNo: 6, order: 1, payload: {} };
  assert.deepEqual(deriveNextAction(base({ activeOp: op, opEvidence: [ev6] })), { actor: "TABLE", stepNo: 8, action: "TEST" });
  assert.equal(deriveNextAction(base({ target: { code: "fit_test", phase: "FINISH", requiresQc: true } })).wait, "AWAITING_QC");
  assert.equal(deriveNextAction(base({ target: { code: "corner_sewing", phase: "FINISH", isPostQc: true } })).stepNo, 9);
  assert.equal(deriveNextAction(base({ step9SinceQc: true, target: { code: "corner_sewing", phase: "FINISH", isPostQc: true } })).stepNo, 10);
  assert.equal(deriveNextAction(base({ target: { code: "finished", phase: "FINISH", isPostQc: true } })).action, "FINISH");
});

test("bukti tahap 6 jalur pengerjaan: bahan OPSIONAL; penjelasan pengerjaan tetap wajib; restorasi tetap mewajibkan bahan", () => {
  const issued = new Map([["m1", 5]]);
  const ok = validateStepEvidence(6, { media: [VID], payload: { note: "Rangka + busa sesuai spesifikasi Sales", materials: [] } }, { issuedQtyByMaterial: issued, buildTrack: true });
  assert.equal(ok.payload.materials.length, 0);
  const withMat = validateStepEvidence(6, { media: [VID], payload: { note: "Rangka + busa sesuai spesifikasi Sales", materials: [{ materialId: "m1", qty: 2 }] } }, { issuedQtyByMaterial: issued, buildTrack: true });
  assert.equal(withMat.payload.materials.length, 1, "bahan yang dipakai tetap tercatat");
  assert.throws(() => validateStepEvidence(6, { media: [VID], payload: { note: "", materials: [] } }, { issuedQtyByMaterial: issued, buildTrack: true }), (e) => e.code === "STEP_EVIDENCE_INVALID");
  assert.throws(() => validateStepEvidence(6, { media: [VID], payload: { note: "Isi fondasi", materials: [] } }, { issuedQtyByMaterial: issued }), (e) => e.code === "STEP_EVIDENCE_INVALID", "restorasi: bahan wajib");
  assert.throws(() => validateStepEvidence(6, { media: [VID], payload: { note: "Pengerjaan", materials: [{ materialId: "mX", qty: 1 }] } }, { issuedQtyByMaterial: issued, buildTrack: true }), (e) => e.code === "STEP_MATERIAL_NOT_ISSUED", "bahan yang dilaporkan tetap harus yang diserahkan Gudang");
});

test("indikator kartu: layanan teknis TIDAK_BERLAKU, BOM OPSIONAL pada jalur pengerjaan; restorasi tetap BELUM", () => {
  const run = { origin: "WORKSHOP_BORN", custodyHandoffs: [], plan: { bomLines: [] }, unit: { serviceId: null }, operations: [], adaptationPolicy: null };
  const mat = { key: "BOM_BELUM_ADA" };
  const b = indicatorsOf(run, { state: { buildTrack: true, activeOp: null }, latestInspection: null }, mat);
  assert.equal(b.service, "TIDAK_BERLAKU");
  assert.equal(b.bom, "OPSIONAL");
  assert.equal(b.custody, "LAHIR_DI_WORKSHOP");
  const r = indicatorsOf(run, { state: { buildTrack: false, activeOp: null }, latestInspection: null }, mat);
  assert.equal(r.service, "BELUM");
  assert.equal(r.bom, "BELUM");
  run.plan.bomLines = [{}];
  assert.equal(indicatorsOf(run, { state: { buildTrack: true, activeOp: null }, latestInspection: null }, mat).bom, "OK", "BOM yang dibuat tetap tampil");
});
