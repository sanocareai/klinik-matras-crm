import assert from "node:assert/strict";
import test from "node:test";
import { BUILD_CATEGORIES, BUILD_NA_STEPS, BUILD_STAGE_CODE, BUILD_STAGE_LABEL, NON_KASUR_NA_REASON, buildApplicableSteps, classifyProduct, isBuildTrack, isNonKasurFlow, pathHasBuildStage, stepLabelFor } from "../src/lib/domain/productionBuildTrack.js";
import { validateInspectionInput } from "../src/services/productionQcHandoffCommandService.js";
import { STEPS, deriveNextAction, stepNoForStage, validateStepEvidence } from "../src/lib/domain/productionSteps.js";
import { applicableStepsFor } from "../src/services/productionStepCommandService.js";
import { buildReportMessage, stepStatuses, indicatorsOf } from "../src/services/productionExperienceReadService.js";
import { buildUnitPath } from "../src/lib/domain/routing.js";
import { workshopPathOf } from "../src/services/productionWorkshopExecutionCommandService.js";

const VID = `/media/production-evidence/${"b".repeat(40)}.mp4`;
const IMG = `/media/production-evidence/${"a".repeat(40)}.jpg`;
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

test("bukti tahap 6 jalur pengerjaan KASUR: racikan wajib, bahan OPSIONAL, foto cukup; restorasi tetap mewajibkan bahan+video", () => {
  const issued = new Map([["m1", 5]]);
  const kasur = { issuedQtyByMaterial: issued, buildTrack: true, productFlow: "KASUR" };
  const racik = { fondasi: "Pocket spring 25 cm", lapisan: "Latex 3 cm" };
  const ok = validateStepEvidence(6, { media: [IMG], payload: { note: "Rangka + pocket spring sesuai spesifikasi Sales", racikan: racik, materials: [] } }, kasur);
  assert.equal(ok.payload.materials.length, 0);
  assert.deepEqual(ok.payload.racikan, racik);
  const withMat = validateStepEvidence(6, { media: [VID], payload: { note: "Rangka + busa sesuai spesifikasi Sales", racikan: { fondasi: "Pocket spring" }, materials: [{ materialId: "m1", qty: 2 }] } }, kasur);
  assert.equal(withMat.payload.materials.length, 1, "bahan yang dipakai tetap tercatat");
  assert.deepEqual(withMat.payload.racikan, { fondasi: "Pocket spring", lapisan: null });
  assert.throws(() => validateStepEvidence(6, { media: [IMG], payload: { note: "Tanpa racikan", materials: [] } }, kasur), (e) => e.code === "STEP_EVIDENCE_INVALID", "kasur: racikan wajib");
  assert.throws(() => validateStepEvidence(6, { media: [IMG], payload: { note: "x", racikan: { fondasi: "ab" } } }, kasur), (e) => e.code === "STEP_EVIDENCE_INVALID", "racikan minimal 3 karakter");
  assert.throws(() => validateStepEvidence(6, { media: [IMG], payload: { note: "", racikan: racik, materials: [] } }, kasur), (e) => e.code === "STEP_EVIDENCE_INVALID", "penjelasan pengerjaan tetap wajib");
  assert.throws(() => validateStepEvidence(6, { media: [], payload: { note: "Pengerjaan", racikan: racik } }, kasur), (e) => e.code === "STEP_EVIDENCE_INVALID", "bukti media tetap wajib");
  assert.throws(() => validateStepEvidence(6, { media: [IMG], payload: { note: "Isi fondasi", materials: [] } }, { issuedQtyByMaterial: issued }), (e) => e.code === "STEP_EVIDENCE_INVALID", "restorasi: bahan wajib");
  assert.throws(() => validateStepEvidence(6, { media: [IMG], payload: { note: "Isi fondasi", materials: [{ materialId: "m1", qty: 1 }] } }, { issuedQtyByMaterial: issued }), (e) => e.code === "STEP_EVIDENCE_INVALID", "restorasi: video wajib");
  assert.throws(() => validateStepEvidence(6, { media: [VID], payload: { note: "Pengerjaan", racikan: racik, materials: [{ materialId: "mX", qty: 1 }] } }, kasur), (e) => e.code === "STEP_MATERIAL_NOT_ISSUED", "bahan yang dilaporkan tetap harus yang diserahkan Gudang");
  assert.throws(() => validateStepEvidence(6, { media: [VID], payload: { note: "Pengerjaan", racikan: racik, materials: [{ materialId: "m1", qty: 9 }] } }, kasur), (e) => e.code === "STEP_MATERIAL_OVER_ISSUED", "tidak boleh melebihi yang diserahkan");
});

test("bukti tahap 6 NON-kasur (divan/sofa): tanpa racikan kasur; penjelasan + foto cukup", () => {
  const ctx = { issuedQtyByMaterial: new Map(), buildTrack: true, productFlow: "NON_KASUR" };
  const ok = validateStepEvidence(6, { media: [IMG], payload: { note: "Divan sesuai ukuran pesanan, rangka kayu", racikan: { fondasi: "diabaikan" } } }, ctx);
  assert.equal("racikan" in ok.payload, false, "racikan kasur tidak dikenakan/disimpan untuk non-kasur");
  assert.equal(ok.payload.materials.length, 0);
});

test("klasifikasi produk KANONIS (lini + jenis), bukan nama/awalan resi; konflik dan data kurang dilaporkan, tidak ditebak", () => {
  const c = (productLine, productType) => classifyProduct({ productLine, productType });
  for (const t of ["KASUR_SPRING", "KASUR_BUSA", "MULTIBED", "KASUR_2IN1_ATAS", "KASUR_2IN1_BAWAH", "KASUR_SEHAT", "KASUR_2IN1", "KASUR_LAINNYA"]) {
    assert.deepEqual([c("KASUR", t).productClass, c("KASUR", t).flow, c("KASUR", t).problem], ["KASUR", "KASUR", null], t);
  }
  for (const [line, t] of [["SOFA", "SOFABED"], ["SOFA", "SOFA_L"], ["SOFA", "SOFA_1_SEATER"], ["SOFA", "SOFA_2_SEATER"], ["SOFA", "SOFA_3_SEATER"], ["DIVAN", "DIVAN_UTAMA"], ["DIVAN", "DIVAN_SANDARAN"]]) {
    assert.deepEqual([c(line, t).productClass, c(line, t).flow, c(line, t).problem], ["NON_KASUR", "NON_KASUR", null], t);
  }
  assert.equal(c("SOFA", null).productClass, "NON_KASUR", "lini eksplisit non-kasur cukup");
  assert.equal(c("DIVAN", null).flow, "NON_KASUR");
  const bawaan = c("KASUR", null);
  assert.deepEqual([bawaan.productClass, bawaan.flow], ["KASUR", "KASUR"]); assert.match(bawaan.problem, /Jenis kasur belum diisi/, "lini KASUR bawaan tanpa jenis dilaporkan");
  const konflik = c("KASUR", "SOFA_L");
  assert.deepEqual([konflik.productClass, konflik.flow], ["BELUM_JELAS", "KASUR"], "konflik: alur kasur dipakai (gerbang mutu tidak dilonggarkan) + dilaporkan"); assert.match(konflik.problem, /tidak sesuai/);
  assert.equal(c("DIVAN", "KASUR_SPRING").productClass, "BELUM_JELAS");
  assert.equal(c(null, null).productClass, "BELUM_JELAS");
  assert.equal(c("KASUR", "JENIS_BARU_TAK_DIKENAL").productClass, "BELUM_JELAS");
  assert.equal(classifyProduct({}).flow, "KASUR");
  assert.equal(isNonKasurFlow("NON_KASUR"), true); assert.equal(isNonKasurFlow("KASUR"), false);
});

test("tahap berlaku per alur produk: kasur 6,8–12; non-kasur 6,9–12 (uji tekstur tidak berlaku); jalur restorasi tidak terpengaruh", () => {
  assert.deepEqual(applicableStepsFor(build, "KASUR"), [6, 8, 9, 10, 11, 12]);
  assert.deepEqual(applicableStepsFor(build, "NON_KASUR"), [6, 9, 10, 11, 12]);
  assert.deepEqual(buildApplicableSteps("NON_KASUR"), [6, 9, 10, 11, 12]);
  assert.deepEqual(applicableStepsFor(restoration, "NON_KASUR"), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], "alur produk hanya berlaku pada jalur pengerjaan");
  const next = deriveNextAction(base({ productFlow: "NON_KASUR", target: { code: BUILD_STAGE_CODE, phase: "MODULE", sequence: 10 } }));
  const steps = stepStatuses({ split: build, evidence: [], next, state: { buildTrack: true, productFlow: "NON_KASUR" } });
  const s8 = steps.find((x) => x.no === 8);
  assert.equal(s8.status, "NA"); assert.equal(s8.naReason, NON_KASUR_NA_REASON);
  assert.equal(stepStatuses({ split: build, evidence: [], next, state: { buildTrack: true, productFlow: "KASUR" } }).find((x) => x.no === 8).status, "PENDING");
});

test("derivasi NON-kasur: tanpa uji tekstur — satu kiriman bukti menutup Pengerjaan Pesanan lalu menunggu pemeriksaan QC; kasur tetap EVIDENCE -> TEST", () => {
  const op = { stageCode: BUILD_STAGE_CODE, stagePhase: "MODULE", stageSequence: 10, status: "ACTIVE", isLastPreQc: true };
  assert.deepEqual(deriveNextAction(base({ productFlow: "NON_KASUR", activeOp: op })), { actor: "TABLE", stepNo: 6, action: "COMPLETE" });
  assert.deepEqual(deriveNextAction(base({ productFlow: "KASUR", activeOp: op })), { actor: "TABLE", stepNo: 6, action: "EVIDENCE", rework: false, lastVerdict: null });
  assert.deepEqual(deriveNextAction(base({ productFlow: "NON_KASUR", target: { code: BUILD_STAGE_CODE, phase: "MODULE", sequence: 10 } })), { actor: "TABLE", stepNo: 6, action: "START" });
  const qcWait = deriveNextAction(base({ productFlow: "NON_KASUR", target: { code: "fit_test", phase: "FINISH", requiresQc: true } }));
  assert.equal(qcWait.wait, "AWAITING_QC"); assert.equal(qcWait.stepNo, null, "divan/sofa: tidak menyebut tahap 8 (uji tekstur kasur)");
  assert.equal(deriveNextAction(base({ productFlow: "KASUR", target: { code: "fit_test", phase: "FINISH", requiresQc: true } })).stepNo, 8);
  assert.equal(deriveNextAction(base({ productFlow: "NON_KASUR", adaptation: true, target: { code: "fit_test", phase: "FINISH", requiresQc: true } })).qcNotPerformed, true, "adaptasi: QC boleh tidak dilakukan");
});

test("QC generik NON-kasur: tanpa berat acuan/uji berat badan; foto wajib; FAIL wajib catatan + tahap rework; fitVerdict ditolak; kasur tetap wajib berat acuan", () => {
  const photo = ["/media/job-photos/qc.jpg"];
  const pass = validateInspectionInput({ result: "PASS", photoUrls: photo, note: "rapi" }, { generic: true });
  assert.deepEqual([pass.generic, pass.fitVerdict, pass.referenceWeightKg], [true, null, undefined]);
  assert.throws(() => validateInspectionInput({ result: "PASS", photoUrls: [] }, { generic: true }), (e) => e.code === "QC_EVIDENCE_REQUIRED");
  assert.throws(() => validateInspectionInput({ result: "PASS", photoUrls: photo, fitVerdict: "PAS" }, { generic: true }), (e) => e.code === "QC_GENERIC_NO_FIT");
  assert.throws(() => validateInspectionInput({ result: "PASS", photoUrls: photo, customerPreferenceOverride: "KERAS" }, { generic: true }), (e) => e.code === "QC_GENERIC_NO_FIT");
  assert.throws(() => validateInspectionInput({ result: "FAIL", photoUrls: photo, note: "ab", reworkStageId: "s" }, { generic: true }), (e) => e.code === "QC_NOTE_REQUIRED");
  assert.throws(() => validateInspectionInput({ result: "FAIL", photoUrls: photo, note: "Rangka miring" }, { generic: true }), (e) => e.code === "QC_REWORK_STAGE_REQUIRED");
  assert.equal(validateInspectionInput({ result: "FAIL", photoUrls: photo, note: "Rangka miring", reworkStageId: "s" }, { generic: true }).reworkStageId, "s");
  assert.throws(() => validateInspectionInput({ result: "PASS", photoUrls: photo, note: "rapi" }), (e) => e.code === "QC_WEIGHT_REQUIRED", "kasur tetap wajib berat acuan");
  assert.equal(validateInspectionInput({ result: "WAIVED", reason: "alasan waive cukup panjang" }, { generic: true }).result, "WAIVED");
});

test("laporan jalur pengerjaan: spesifikasi Sales + racikan + bahan, tanpa bagian diagnosa/bongkar/restorasi", () => {
  const report = {
    track: "BUILD", order: { orderNumber: "NEW-1", customerName: "Bu A", request: "Tekstur firm", complaints: [] }, unit: { merk: "Custom", ukuran: "170x210" }, pic: { table: "Febri", corner: "Ferdy", sales: "S" },
    build: { salesServices: ["Kasur Custom Pocket Spring"], racikan: { fondasi: "PS 25", lapisan: "Latex 3" }, note: "Selesai sesuai spesifikasi" },
    materials: { foundation: [{ name: "Pocket Spring", code: "PS-1" }], layer: [], finishing: [] }, finalTest: null, finishing: null, skippedSteps: [], qcStatus: "BELUM", qc: { result: "PASS" }, product: { flow: "KASUR" },
    mediaCount: 4, reportPath: "/x", adaptation: false, status: "ACTIVE", handoffStatus: null,
  };
  const msg = buildReportMessage(report);
  assert.match(msg, /SPESIFIKASI PESANAN/); assert.match(msg, /Kasur Custom Pocket Spring/); assert.match(msg, /Racikan Fondasi : PS 25/); assert.match(msg, /Racikan Lapisan : Latex 3/); assert.match(msg, /Pocket Spring \(PS-1\)/);
  assert.doesNotMatch(msg, /DIAGNOSA|BONGKAR|RESTORASI/);
  const non = buildReportMessage({ ...report, product: { flow: "NON_KASUR" }, build: { ...report.build, racikan: null } });
  assert.match(non, /pemeriksaan hasil/); assert.doesNotMatch(non, /Racikan/);
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
