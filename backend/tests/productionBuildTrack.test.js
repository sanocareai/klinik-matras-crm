import assert from "node:assert/strict";
import test from "node:test";
import { BUILD_CATEGORIES, BUILD_NA_STEPS, BUILD_STAGE_CODE, BUILD_STAGE_LABEL, NON_KASUR_NA_REASON, buildApplicableSteps, classifyProduct, isBuildTrack, isNonKasurFlow, isUnconfirmedFlow, pathHasBuildStage, stepLabelFor } from "../src/lib/domain/productionBuildTrack.js";
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

test("derivasi KASUR: setelah mulai -> bukti tahap 6 -> uji tekstur (8) -> QC -> Kirim ke Corner -> Corner -> Finish (Corner dikonfirmasi diperlukan)", () => {
  const op = { stageCode: BUILD_STAGE_CODE, stagePhase: "MODULE", stageSequence: 10, status: "ACTIVE", isLastPreQc: true };
  const k = (over = {}) => base({ productFlow: "KASUR", cornerRequired: true, racikanRecorded: true, ...over });
  assert.deepEqual(deriveNextAction(k({ activeOp: op })), { actor: "TABLE", stepNo: 6, action: "EVIDENCE", rework: false, lastVerdict: null });
  const ev6 = { stepNo: 6, order: 1, payload: {} };
  assert.deepEqual(deriveNextAction(k({ activeOp: op, opEvidence: [ev6] })), { actor: "TABLE", stepNo: 8, action: "TEST" });
  assert.equal(deriveNextAction(k({ target: { code: "fit_test", phase: "FINISH", requiresQc: true } })).wait, "AWAITING_QC");
  assert.equal(deriveNextAction(k({ target: { code: "corner_sewing", phase: "FINISH", isPostQc: true } })).stepNo, 9);
  assert.equal(deriveNextAction(k({ step9SinceQc: true, target: { code: "corner_sewing", phase: "FINISH", isPostQc: true } })).stepNo, 10);
  assert.equal(deriveNextAction(k({ target: { code: "finished", phase: "FINISH", isPostQc: true } })).action, "FINISH");
  assert.equal(deriveNextAction(k({ target: { code: "finished", phase: "FINISH", isPostQc: true } })).actor, "CORNER");
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

test("klasifikasi produk KANONIS (lini + jenis), bukan nama/awalan resi; TANPA fallback ke kasur: jenis belum jelas = UNCONFIRMED + kebutuhan konfirmasi", () => {
  const c = (productLine, productType) => classifyProduct({ productLine, productType });
  for (const t of ["KASUR_SPRING", "KASUR_BUSA", "MULTIBED", "KASUR_2IN1_ATAS", "KASUR_2IN1_BAWAH", "KASUR_SEHAT", "KASUR_2IN1", "KASUR_LAINNYA"]) {
    assert.deepEqual([c("KASUR", t).productClass, c("KASUR", t).flow, c("KASUR", t).problem], ["KASUR", "KASUR", null], t);
  }
  for (const [line, t] of [["SOFA", "SOFABED"], ["SOFA", "SOFA_L"], ["SOFA", "SOFA_1_SEATER"], ["SOFA", "SOFA_2_SEATER"], ["SOFA", "SOFA_3_SEATER"], ["DIVAN", "DIVAN_UTAMA"], ["DIVAN", "DIVAN_SANDARAN"]]) {
    assert.deepEqual([c(line, t).productClass, c(line, t).flow, c(line, t).problem], ["NON_KASUR", "NON_KASUR", null], t);
  }
  assert.equal(c("SOFA", null).productClass, "NON_KASUR", "lini eksplisit non-kasur cukup");
  assert.equal(c("DIVAN", null).flow, "NON_KASUR");
  // Tidak ada fallback ke kasur: semua kasus kurang/konflik = UNCONFIRMED dengan penjelasan
  const unconfirmed = [c("KASUR", null), c("KASUR", "SOFA_L"), c("DIVAN", "KASUR_SPRING"), c(null, null), c("KASUR", "JENIS_BARU_TAK_DIKENAL"), classifyProduct({})];
  for (const u of unconfirmed) { assert.deepEqual([u.productClass, u.flow], ["BELUM_JELAS", "UNCONFIRMED"]); assert.ok(u.problem && u.problem.length > 10, "alasan konfirmasi disebut"); }
  assert.match(c("KASUR", null).problem, /Jenis kasur belum diisi/);
  assert.match(c("KASUR", "SOFA_L").problem, /tidak sesuai/);
  assert.equal(isNonKasurFlow("NON_KASUR"), true); assert.equal(isNonKasurFlow("KASUR"), false); assert.equal(isNonKasurFlow("UNCONFIRMED"), false);
  assert.equal(isUnconfirmedFlow("UNCONFIRMED"), true);
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
  assert.deepEqual(deriveNextAction(base({ productFlow: "NON_KASUR", cornerRequired: true, activeOp: op })), { actor: "TABLE", stepNo: 6, action: "COMPLETE" });
  assert.deepEqual(deriveNextAction(base({ productFlow: "KASUR", cornerRequired: true, activeOp: op })), { actor: "TABLE", stepNo: 6, action: "EVIDENCE", rework: false, lastVerdict: null });
  assert.deepEqual(deriveNextAction(base({ productFlow: "NON_KASUR", target: { code: BUILD_STAGE_CODE, phase: "MODULE", sequence: 10 } })), { actor: "TABLE", stepNo: 6, action: "START" });
  const qcWait = deriveNextAction(base({ productFlow: "NON_KASUR", cornerRequired: true, target: { code: "fit_test", phase: "FINISH", requiresQc: true } }));
  assert.equal(qcWait.wait, "AWAITING_QC"); assert.equal(qcWait.stepNo, null, "divan/sofa: tidak menyebut tahap 8 (uji tekstur kasur)");
  assert.equal(deriveNextAction(base({ productFlow: "KASUR", cornerRequired: true, target: { code: "fit_test", phase: "FINISH", requiresQc: true } })).stepNo, 8);
  assert.equal(deriveNextAction(base({ productFlow: "NON_KASUR", cornerRequired: true, adaptation: true, target: { code: "fit_test", phase: "FINISH", requiresQc: true } })).qcNotPerformed, true, "adaptasi: QC boleh tidak dilakukan");
});

test("jenis produk belum jelas (UNCONFIRMED): catatan/dokumentasi UMUM tetap bisa disimpan; racikan + uji khusus kasur (8, QC) ditahan; tanpa fallback ke kasur", () => {
  const op = { stageCode: BUILD_STAGE_CODE, stagePhase: "MODULE", stageSequence: 10, status: "ACTIVE", isLastPreQc: true };
  assert.deepEqual(deriveNextAction(base({ productFlow: "UNCONFIRMED", target: { code: BUILD_STAGE_CODE, phase: "MODULE", sequence: 10 } })), { actor: "TABLE", stepNo: 6, action: "START" }, "pekerjaan fisik boleh dimulai");
  const w = deriveNextAction(base({ productFlow: "UNCONFIRMED", productProblem: "Jenis kasur belum diisi", activeOp: op }));
  assert.deepEqual([w.action, w.general, w.hold, w.actor, w.stepNo, w.problem], ["EVIDENCE", true, "PRODUCT_TYPE_UNCONFIRMED", "TABLE", 6, "Jenis kasur belum diisi"], "catatan umum boleh; alasan penahanan dijelaskan");
  // setelah catatan umum tersimpan: tetap EVIDENCE umum (tidak pernah TEST/COMPLETE selama belum jelas)
  assert.equal(deriveNextAction(base({ productFlow: "UNCONFIRMED", activeOp: op, opEvidence: [{ stepNo: 6, order: 1, payload: { general: true } }] })).action, "EVIDENCE");
  const ctx = { issuedQtyByMaterial: new Map(), buildTrack: true, productFlow: "UNCONFIRMED" };
  const saved = validateStepEvidence(6, { media: [IMG], payload: { note: "Rangka sudah dirakit", racikan: { fondasi: "Pocket spring" } } }, ctx);
  assert.equal(saved.payload.general, true); assert.equal("racikan" in saved.payload, false, "racikan khusus jenis produk TIDAK disimpan");
  assert.throws(() => validateStepEvidence(6, { media: [], payload: { note: "Rangka sudah dirakit" } }, ctx), (e) => e.code === "STEP_EVIDENCE_INVALID", "dokumentasi (foto/video) tetap wajib");
  assert.throws(() => validateStepEvidence(6, { media: [IMG], payload: { note: "" } }, ctx), (e) => e.code === "STEP_EVIDENCE_INVALID", "penjelasan tetap wajib");
  assert.deepEqual(buildApplicableSteps("UNCONFIRMED"), [6, 8, 9, 10, 11, 12], "tahap 8 tetap tercatat berlaku-belum-jelas (ditahan), bukan dihapus");
  // setelah Sales memperbaiki ke KASUR: bukti umum TIDAK cukup — racikan tetap wajib sebelum uji tekstur
  const afterFix = deriveNextAction(base({ productFlow: "KASUR", cornerRequired: true, racikanRecorded: false, activeOp: op, opEvidence: [{ stepNo: 6, order: 1, payload: { general: true } }] }));
  assert.deepEqual([afterFix.action, afterFix.stepNo], ["EVIDENCE", 6], "racikan wajib dulu");
  assert.deepEqual(deriveNextAction(base({ productFlow: "KASUR", cornerRequired: true, racikanRecorded: true, activeOp: op, opEvidence: [{ stepNo: 6, order: 1, payload: { racikan: { fondasi: "PS" } } }] })), { actor: "TABLE", stepNo: 8, action: "TEST" });
});

test("PIC Bahan per pekerjaan: racikan dicatat PIC Bahan lebih dulu (PIC Meja menunggu); pemakaian bahan tidak ganda di bukti PIC Meja", () => {
  const op = { stageCode: BUILD_STAGE_CODE, stagePhase: "MODULE", stageSequence: 10, status: "ACTIVE", isLastPreQc: true };
  const w = deriveNextAction(base({ productFlow: "KASUR", cornerRequired: true, materialOperatorId: "op-bahan", racikanRecorded: false, activeOp: op }));
  assert.deepEqual([w.action, w.wait, w.actor], ["WAIT", "RACIKAN_NOT_RECORDED", "MATERIAL_PIC"]);
  assert.equal(deriveNextAction(base({ productFlow: "KASUR", cornerRequired: true, materialOperatorId: "op-bahan", racikanRecorded: true, activeOp: op })).action, "EVIDENCE");
  const ctx = { issuedQtyByMaterial: new Map([["m1", 5]]), buildTrack: true, productFlow: "KASUR", racikanRecorded: true, materialsByPic: true };
  const ok = validateStepEvidence(6, { media: [IMG], payload: { note: "Pengerjaan sesuai racikan PIC Bahan" } }, ctx);
  assert.equal("racikan" in ok.payload, false, "racikan dari catatan PIC Bahan memenuhi syarat; tidak dipaksa diisi ulang");
  assert.throws(() => validateStepEvidence(6, { media: [IMG], payload: { note: "x yy", materials: [{ materialId: "m1", qty: 1 }] } }, ctx), (e) => e.statusCode === 409 && e.code === "STEP_MATERIAL_BY_MATERIAL_PIC");
  assert.throws(() => validateStepEvidence(6, { media: [IMG], payload: { note: "x yy" } }, { ...ctx, racikanRecorded: false }), (e) => e.code === "STEP_EVIDENCE_INVALID", "tanpa racikan dari mana pun tetap ditolak untuk kasur");
});

test("Corner mengikuti kebutuhan yang DIKONFIRMASI pada rencana, bukan jenis produk: belum dikonfirmasi menahan; tidak perlu = tahap 9–11 tidak berlaku beralasan", () => {
  const gate = { code: "fit_test", phase: "FINISH", requiresQc: true };
  for (const flow of ["KASUR", "NON_KASUR"]) {
    const w = deriveNextAction(base({ productFlow: flow, cornerRequired: null, target: gate }));
    assert.deepEqual([w.action, w.wait, w.actor, w.stepNo], ["WAIT", "CORNER_NOT_CONFIRMED", "PLANNER", 9], flow + ": Corner belum dikonfirmasi");
    assert.equal(deriveNextAction(base({ productFlow: flow, cornerRequired: true, target: gate })).wait, "AWAITING_QC", flow + ": Corner diperlukan -> jalur normal");
  }
  // Tidak diperlukan + adaptasi: tidak ada pemicu "Kirim ke Corner" -> Selesaikan Produksi; QC dicatat tidak dilakukan lewat penutupan.
  const fin = deriveNextAction(base({ productFlow: "NON_KASUR", cornerRequired: false, adaptation: true, target: gate }));
  assert.deepEqual([fin.wait, fin.stepNo], ["READY_TO_FINISH", 12]);
  // Tidak diperlukan, tanpa adaptasi: setelah QC langsung Finish oleh PIC Meja (bukan Corner)
  const finish = deriveNextAction(base({ productFlow: "KASUR", cornerRequired: false, target: { code: "finished", phase: "FINISH", isPostQc: true } }));
  assert.deepEqual([finish.actor, finish.stepNo, finish.action], ["TABLE", 12, "FINISH"]);
  // Tahap berlaku: jalur tanpa corner_sewing -> 9–11 TIDAK BERLAKU
  const noCorner = workshopPathOf(buildUnitPath([], [BUILD], FINISH.filter((st) => st.code !== "corner_sewing")));
  assert.deepEqual(noCorner.postQcStages.map((st) => st.code), ["finished"]);
  assert.deepEqual(applicableStepsFor(noCorner, "KASUR"), [6, 8, 12]);
  assert.deepEqual(applicableStepsFor(noCorner, "NON_KASUR"), [6, 12]);
  assert.deepEqual(applicableStepsFor(build, "NON_KASUR"), [6, 9, 10, 11, 12], "dengan Corner: divan/sofa tetap melewati Corner");
  assert.deepEqual(buildApplicableSteps("KASUR", { corner: false }), [6, 8, 12]);
  const next = deriveNextAction(base({ productFlow: "NON_KASUR", cornerRequired: false, target: { code: BUILD_STAGE_CODE, phase: "MODULE", sequence: 10 } }));
  const steps = stepStatuses({ split: noCorner, evidence: [], next, state: { buildTrack: true, productFlow: "NON_KASUR", cornerRequired: false, cornerReason: "Tidak ada pekerjaan kain" } });
  for (const n of [9, 10, 11]) { const st = steps.find((x) => x.no === n); assert.equal(st.status, "NA"); assert.match(st.naReason, /Corner tidak diperlukan — Tidak ada pekerjaan kain/); }
  assert.equal(steps.find((x) => x.no === 12).status, "PENDING", "Finish tetap dikerjakan, bukan NA");
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

// Audit penulis: pengaturan Run + catatan bahan HANYA ditulis productionBuildCommandService; service itu tidak menulis stok/reservasi/issue/jurnal/rencana/bukti/tahap.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
test("audit penulis jalur pengerjaan: dua tabel baru hanya ditulis satu service; tanpa tulis stok/rencana/bukti; migrasi aditif + append-only + LF", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith(".js")) files.push(p); } };
  walk(root);
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const OWNER = "services/productionBuildCommandService.js";
  const writers = [];
  for (const p of files) {
    const rel = path.relative(root, p).replace(/\\/g, "/"); const t = strip(fs.readFileSync(p, "utf8"));
    if (/\.(productionRunBuildSetting|productionBuildMaterialRecord)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/.test(t)) writers.push(rel);
    if (/production_run_build_settings_v2|production_build_material_records_v2/.test(t) && /\$executeRaw/.test(t)) writers.push(rel + "#RAW");
  }
  assert.deepEqual(writers, [OWNER], "penulis tunggal");
  const svc = strip(fs.readFileSync(path.join(root, OWNER), "utf8"));
  for (const forbidden of [/\.stockMovement\.(create|update|delete|upsert)/, /\.materialReservation\.(create|update|delete|upsert)/, /\.materialIssue(Line)?\.(create|update|delete|upsert)/, /\.productionRunPlan\.(create|update|delete|upsert)/, /\.productionStepEvidence\.(create|update|delete|upsert)/, /\.unitStageLog\.(create|update|delete)/, /\.productionOperationRun\.(create|update|delete)/, /\.productionPhaseRun\.(create|update)/, /postStockMovement|postMaterialIssueCost|journalEntry/]) {
    assert.doesNotMatch(svc, forbidden, String(forbidden));
  }
  assert.match(svc, /bumpRunRevisionInTx/, "revisi Run lewat helper P5, bukan tulis langsung");
  assert.doesNotMatch(svc, /\.productionRun\.(update|create)/);
  const mig = fs.readFileSync(path.resolve(root, "../prisma/migrations/20261019100000_production_build_plan_settings/migration.sql"), "utf8");
  assert.doesNotMatch(mig.replace(/^--.*$/gm, ""), /\bDROP\b|\bDELETE\s+FROM\b|\bUPDATE\s+"/i, "migrasi aditif");
  assert.match(mig, /BEFORE UPDATE OR DELETE ON "production_build_material_records_v2"/, "catatan append-only");
  assert.match(mig, /corner_reason_check/); assert.doesNotMatch(mig, /\r/, "LF");
});
