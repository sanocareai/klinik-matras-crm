// Fase 4 Produksi LAYANAN — domain murni: kesebandingan uji awal vs setelah perbaikan, deteksi perbedaan hasil aktual dari rencana, gerbang perakitan di engine tahap.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  QC_SECTION_KEYS, buildMeasurements, detectDeviation, normalizeSectionData,
} from "../src/lib/domain/productionComponents.js";
import { deriveNextAction, validateStepEvidence } from "../src/lib/domain/productionSteps.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const man = (t) => ({ kind: "MANUAL", text: t });
const FB = { system: "BONNELL", unloadedHeightCm: 25, loadedHeightCm: 15, testerWeightKg: 75, testMethod: "Beban di tengah rangka" };
const FA = (o = {}) => ({ system: "BONNELL", unloadedHeightCm: 25, loadedHeightCm: 23, testerWeightKg: 75, testMethod: "Beban di tengah rangka", sameMethodAsBefore: true, ...o });
const WB = { complaintMatch: "SEBAGIAN", feelNote: "Tengah terasa amblas", testerWeightKg: 75, testMethod: "Berbaring di tengah", wholeDropCm: 3, qcInFrame: true };
const WA = (o = {}) => ({ complaintMatch: "SESUAI", feelNote: "Tengah kokoh", testerWeightKg: 75, testMethod: "Berbaring di tengah", wholeDropCm: 1, qcInFrame: true, sameMethodAsBefore: true, ...o });
const E = (sec, d) => ({ version: 1, data: normalizeSectionData(sec, d) });

test("seksi uji setelah perbaikan = seksi QC; penurunan dihitung server; nilai klien diabaikan; media wajib", () => {
  assert.deepEqual(QC_SECTION_KEYS, ["WHOLE_TEST_BEFORE", "FOUNDATION_TEST_BEFORE", "FOUNDATION_TEST_AFTER", "WHOLE_TEST_AFTER"]);
  const f = normalizeSectionData("FOUNDATION_TEST_AFTER", FA({ dropCm: 99 })); assert.equal(f.dropCm, 2); assert.equal(f.sameMethodAsBefore, true);
  assert.equal(normalizeSectionData("FOUNDATION_TEST_AFTER", FA({ sameMethodAsBefore: undefined })).sameMethodAsBefore, false, "tidak ditandai = tidak sebanding");
  assert.throws(() => normalizeSectionData("FOUNDATION_TEST_AFTER", FA({ loadedHeightCm: 30 })), (e) => e.code === "COMPONENT_LOADED_TALLER");
  assert.throws(() => normalizeSectionData("WHOLE_TEST_AFTER", WA({ testerWeightKg: undefined })), (e) => e.code === "COMPONENT_TESTER_WEIGHT_REQUIRED");
  assert.equal(normalizeSectionData("WHOLE_TEST_AFTER", WA({ wholeDropCm: 0 })).wholeDropCm, 0, "0 cm sah");
});

test("kesebandingan = KONFIRMASI PIC QC: berat setara pun tidak otomatis sebanding; berat beda + dikonfirmasi = sebanding (dengan catatan); belum dikonfirmasi = dua angka mentah tanpa selisih", () => {
  const m = (fa, wa) => buildMeasurements({ wholeTest: E("WHOLE_TEST_BEFORE", WB), foundationTest: E("FOUNDATION_TEST_BEFORE", FB), foundationAfter: fa && E("FOUNDATION_TEST_AFTER", fa), wholeAfter: wa && E("WHOLE_TEST_AFTER", wa) });
  const ok = m(FA(), WA()); assert.deepEqual([ok.comparisons.foundation.comparable, ok.comparisons.foundation.differenceCm, ok.comparisons.whole.differenceCm], [true, 8, 2]);
  const same = m(FA({ sameMethodAsBefore: false }), WA({ sameMethodAsBefore: false })); // berat 75 = 75 tetapi PIC QC TIDAK mengonfirmasi
  assert.deepEqual([same.comparisons.foundation.comparable, same.comparisons.foundation.differenceCm, same.comparisons.foundation.reasons, same.comparisons.whole.differenceCm], [false, null, ["METODE_BELUM_DIKONFIRMASI_SEBANDING"], null]);
  assert.match(same.comparisons.foundation.text, /belum valid.*PIC QC belum mengonfirmasi metode pengujian sebanding.*Awal turun 10 cm \(berat 75 kg; Beban di tengah rangka\) · sekarang turun 2 cm \(berat 75 kg; Beban di tengah rangka\).*tanpa selisih/);
  const heavy = m(FA({ testerWeightKg: 60 }), WA({ testerWeightKg: 90 })); // dikonfirmasi sebanding walau berat beda -> selisih tampil + catatan berat
  assert.deepEqual([heavy.comparisons.foundation.comparable, heavy.comparisons.foundation.differenceCm], [true, 8]); assert.match(heavy.comparisons.foundation.text, /dikonfirmasi PIC QC.*berat penguji berbeda \(awal 75 kg, baru 60 kg\), dikonfirmasi sebanding oleh PIC QC/);
  assert.equal(m(null, null).comparisons.foundation.available, false); assert.match(m(null, null).comparisons.foundation.text, /belum dicatat/);
  assert.match(buildMeasurements({ foundationAfter: E("FOUNDATION_TEST_AFTER", FA()) }).comparisons.foundation.text, /Uji awal fondasi belum dicatat/);
  const all = JSON.stringify(ok); assert.doesNotMatch(all, /"total(Drop|Penurunan)"|"sum"|"category"|"kategori"/i); assert.equal(ok.combinedEstimate, null);
  assert.deepEqual(m(null, null).recorded, { whole: true, foundation: true, layers: false, wholeAfter: false, foundationAfter: false });
});

test("deteksi perbedaan hasil aktual dari rencana: sama = tidak beda; bagian belum diisi tidak dihitung; bahan/tindakan/tebal beda = beda; lapisan tambahan/hilang = beda", () => {
  const before = { data: { layers: [{ material: man("Busa lama"), thicknessCm: 6, condition: "AUS" }, { material: { kind: "UNKNOWN" }, thicknessCm: 4, condition: "BAIK" }] }, version: 1 };
  const plan = { data: normalizeSectionData("PLAN_RACIKAN", { foundation: { action: "REPLACE", system: "BONNELL", material: man("Pocket spring") }, layers: [{ action: "REPLACE", material: man("Latex 3 cm"), thicknessCm: 3 }, { action: "KEEP", fromOrder: 2 }] }), version: 1 };
  const aft = (o) => ({ data: normalizeSectionData("AFTER", o), version: 1 });
  const same = { foundation: { action: "REPLACE", system: "BONNELL", material: man("Pocket spring") }, layers: [{ action: "REPLACE", material: man("Latex 3 cm"), thicknessCm: 3 }, { action: "KEEP", fromOrder: 2 }] };
  assert.equal(detectDeviation({ plan, after: aft(same), layersBefore: before }).hasDeviation, false);
  assert.equal(detectDeviation({ plan, after: aft({ foundation: same.foundation }), layersBefore: before }).hasDeviation, false, "lapisan belum diisi = bukan perbedaan");
  assert.equal(detectDeviation({ plan, after: aft({ layers: same.layers }), layersBefore: before }).hasDeviation, false, "fondasi belum dicatat = bukan perbedaan");
  assert.deepEqual(detectDeviation({ plan, after: aft({ ...same, layers: [{ ...same.layers[0], thicknessCm: 4 }, same.layers[1]] }), layersBefore: before }).items.map((i) => [i.part, i.diffs]), [["LAPISAN_1", ["KETEBALAN"]]]);
  assert.deepEqual(detectDeviation({ plan, after: aft({ ...same, layers: [{ ...same.layers[0], material: man("Latex 4 cm") }, same.layers[1]] }), layersBefore: before }).items.map((i) => i.diffs), [["BAHAN"]]);
  assert.equal(detectDeviation({ plan, after: aft({ ...same, foundation: { action: "KEEP", system: "BONNELL" } }), layersBefore: before }).items[0].part, "FONDASI");
  assert.equal(detectDeviation({ plan, after: aft({ ...same, layers: [...same.layers, { action: "REPLACE", material: man("Tambahan"), thicknessCm: 1 }] }), layersBefore: before }).items.at(-1).status, "HANYA_AKTUAL");
  assert.equal(detectDeviation({ plan: null, after: aft(same) }).hasDeviation, false, "tanpa rencana tidak ada yang dibandingkan");
  assert.equal(normalizeSectionData("AFTER", { ...same, deviationNote: "Busa habis" }).deviationNote, "Busa habis"); assert.equal("deviationNote" in normalizeSectionData("AFTER", same), false, "entri lama tanpa kunci");
});

const base = (o = {}) => ({ runStatus: "ACTIVE", currentPhase: "PROCESS", unitStatus: "IN_PRODUCTION", handoffPhaseStatus: null, exceptionOpen: false, activeOp: { stageCode: "comfort_layer_upgrade", stagePhase: "MODULE", stageSequence: 11, status: "ACTIVE", isLastPreQc: true }, target: null, opEvidence: [], serviceSet: true, pathHasModules: true, materialReady: true, diagnosisManualMapped: true, diagnosisBomHasLines: true, buildTrack: false, ...o });
const pick = (n) => ({ action: n.action, wait: n.wait, actor: n.actor, stepNo: n.stepNo });
const FOUND_OP = { stageCode: "foundation_upgrade", stagePhase: "MODULE", stageSequence: 10, status: "ACTIVE", isLastPreQc: true };
test("engine: KEDUANYA (fondasi lalu lapisan): tunggu uji fondasi baru → bukti lapisan (butuh hasil aktual) → tunggu uji kasur jadi → Meja lanjut; tanpa gerbang = alur uji tekstur lama", () => {
  const gate = { assemblyGate: true, assemblyHasFoundation: true, assemblyHasLayers: true };
  assert.deepEqual(pick(deriveNextAction(base({ ...gate }))), { action: "WAIT", wait: "FOUNDATION_NEW_TEST_PENDING", actor: "QC", stepNo: 7 });
  const n1 = deriveNextAction(base({ ...gate, foundationNewTestOk: true })); assert.deepEqual([n1.action, n1.gated, n1.layersAfterRequired], ["EVIDENCE", true, true]);
  const n2 = deriveNextAction(base({ ...gate, foundationNewTestOk: true, afterOk: true })); assert.deepEqual([n2.action, n2.layersAfterRequired], ["EVIDENCE", undefined]);
  const ev = [{ stepNo: 7, payload: {}, order: 0 }];
  assert.deepEqual(pick(deriveNextAction(base({ ...gate, foundationNewTestOk: true, afterOk: true, opEvidence: ev }))), { action: "WAIT", wait: "FINISHED_TEST_PENDING", actor: "QC", stepNo: 8 });
  const n3 = deriveNextAction(base({ ...gate, foundationNewTestOk: true, afterOk: true, wholeTestAfterOk: true, opEvidence: ev })); assert.deepEqual([n3.action, n3.stepNo, n3.continueOnly, n3.qcRecorded], ["TEST", 8, true, true]);
  const legacy = deriveNextAction(base({ opEvidence: [{ stepNo: 7, payload: {}, order: 0 }, { stepNo: 8, payload: { verdict: "TERLALU_KERAS" }, order: 1 }] }));
  assert.deepEqual([legacy.action, legacy.rework], ["EVIDENCE", true], "tanpa gerbang: jalur lama (rework dari uji tekstur) tidak berubah");
  assert.equal(deriveNextAction(base({ opEvidence: ev })).action, "TEST", "tanpa gerbang: Meja menguji tekstur sendiri");
});
test("engine: HANYA LAPISAN (tanpa modul fondasi): tidak menunggu uji fondasi baru; tetap wajib hasil aktual + uji kasur jadi", () => {
  const gate = { assemblyGate: true, assemblyHasFoundation: false, assemblyHasLayers: true };
  const n0 = deriveNextAction(base({ ...gate })); assert.deepEqual([n0.action, n0.gated, n0.layersAfterRequired], ["EVIDENCE", true, true], "langsung bukti lapisan; hasil aktual wajib");
  const ev = [{ stepNo: 7, payload: {}, order: 0 }];
  assert.equal(deriveNextAction(base({ ...gate, afterOk: true, opEvidence: ev })).wait, "FINISHED_TEST_PENDING");
  assert.equal(deriveNextAction(base({ ...gate, afterOk: true, wholeTestAfterOk: true, opEvidence: ev })).action, "TEST");
  assert.equal(deriveNextAction(base({ ...gate, wholeTestAfterOk: true, opEvidence: ev })).wait, "AFTER_PENDING", "uji kasur jadi lama tanpa hasil aktual putaran ini tidak cukup");
});
test("engine: HANYA FONDASI (modul fondasi = modul terakhir): bukti Meja → uji fondasi baru → hasil aktual → uji kasur jadi → lanjut; satu modul tidak melewati gerbang", () => {
  const gate = { assemblyGate: true, assemblyHasFoundation: true, assemblyHasLayers: false, activeOp: FOUND_OP };
  const n0 = deriveNextAction(base({ ...gate })); assert.deepEqual([n0.action, n0.stepNo, n0.gated, n0.layersAfterRequired], ["EVIDENCE", 6, true, undefined], "bukti fondasi dulu");
  const ev = [{ stepNo: 6, payload: {}, order: 0 }];
  assert.deepEqual(pick(deriveNextAction(base({ ...gate, opEvidence: ev }))), { action: "WAIT", wait: "FOUNDATION_NEW_TEST_PENDING", actor: "QC", stepNo: 6 });
  assert.deepEqual(pick(deriveNextAction(base({ ...gate, opEvidence: ev, foundationNewTestOk: true }))), { action: "WAIT", wait: "AFTER_PENDING", actor: "TABLE", stepNo: 6 });
  assert.deepEqual(pick(deriveNextAction(base({ ...gate, opEvidence: ev, foundationNewTestOk: true, afterOk: true }))), { action: "WAIT", wait: "FINISHED_TEST_PENDING", actor: "QC", stepNo: 8 });
  const done = deriveNextAction(base({ ...gate, opEvidence: ev, foundationNewTestOk: true, afterOk: true, wholeTestAfterOk: true })); assert.deepEqual([done.action, done.stepNo, done.continueOnly], ["TEST", 8, true]);
  assert.equal(deriveNextAction(base({ ...gate, opEvidence: ev, afterOk: true, wholeTestAfterOk: true })).wait, "FOUNDATION_NEW_TEST_PENDING", "tanpa uji fondasi baru putaran ini tidak lewat");
});

test("validator tahap 7/8 dengan gerbang: bukti 7 menuntut hasil aktual & menaut versinya; bukti 8 menuntut uji fondasi baru (bila ada modul fondasi) + hasil aktual + uji kasur jadi; sisa bahan kumulatif; tanpa gerbang tidak berubah", () => {
  const media = ["/media/production-evidence/" + "a".repeat(40) + ".jpg"];
  const ctx = { assemblyGate: true, assemblyHasFoundation: true, assemblyRefs: { foundationTestAfter: { version: 1, ok: true }, after: { version: 2, ok: true }, wholeTestAfter: { version: 3, ok: true, mediaUrls: ["/media/production-evidence/" + "b".repeat(40) + ".mp4"] } }, issuedQtyByMaterial: new Map(), required: true };
  const v7 = validateStepEvidence(7, { payload: { note: "lapisan dipasang", materials: [] }, media }, { ...ctx, picRestoration: true, materialsByPic: true });
  assert.deepEqual(v7.payload.afterRef, { section: "AFTER", version: 2 });
  assert.throws(() => validateStepEvidence(7, { payload: {}, media }, { ...ctx, assemblyRefs: { after: null } }), (e) => e.code === "STEP_AFTER_REQUIRED");
  const v8 = validateStepEvidence(8, { payload: {}, media: [] }, ctx); assert.deepEqual(v8.payload, { qcRef: { section: "WHOLE_TEST_AFTER", version: 3 } }); assert.equal(v8.media.length, 1);
  assert.throws(() => validateStepEvidence(8, { payload: {}, media: [] }, { ...ctx, assemblyRefs: { ...ctx.assemblyRefs, wholeTestAfter: null } }), (e) => e.code === "STEP_WAITING_FINISHED_TEST_PENDING");
  assert.throws(() => validateStepEvidence(8, { payload: {}, media: [] }, { ...ctx, assemblyRefs: { ...ctx.assemblyRefs, after: { version: 2, ok: false } } }), (e) => e.code === "STEP_AFTER_REQUIRED", "hasil aktual putaran lama tidak cukup");
  assert.throws(() => validateStepEvidence(8, { payload: {}, media: [] }, { ...ctx, assemblyRefs: { ...ctx.assemblyRefs, foundationTestAfter: { version: 1, ok: false } } }), (e) => e.code === "STEP_WAITING_FOUNDATION_NEW_TEST_PENDING", "uji fondasi baru lama tidak cukup");
  assert.equal(validateStepEvidence(8, { payload: {}, media: [] }, { ...ctx, assemblyHasFoundation: false, assemblyRefs: { ...ctx.assemblyRefs, foundationTestAfter: null } }).payload.qcRef.version, 3, "hanya lapisan: tanpa uji fondasi baru");
  assert.throws(() => validateStepEvidence(8, { payload: {}, media: [] }, { required: true }), (e) => e.code === "STEP_EVIDENCE_INVALID", "tanpa gerbang: bukti 8 tetap butuh video + verdict");
  // bahan: sisa kumulatif (mode sisa) menolak melebihi sisa; pesan menyebut bahan tambahan lewat PIC Bahan
  const issued = new Map([["m1", 1]]);
  assert.throws(() => validateStepEvidence(7, { payload: { materials: [{ materialId: "m1", qty: 2 }] }, media }, { ...ctx, issuedQtyByMaterial: issued, remainingMode: true }), (e) => e.code === "STEP_MATERIAL_OVER_ISSUED" && /sisa bahan yang belum terpakai \(1\).*bahan tambahan diminta PIC Bahan/.test(e.message));
  assert.throws(() => validateStepEvidence(7, { payload: { materials: [{ materialId: "m1", qty: 1 }] }, media }, { ...ctx, issuedQtyByMaterial: new Map([["m1", 0]]), remainingMode: true }), (e) => e.code === "STEP_MATERIAL_OVER_ISSUED", "sisa 0 -> tidak boleh");
});

test("kontrak sumber: kebijakan V2 dipin pada Run baru; Run NULL/V1 tidak terkunci; satu pintu pembaca bukti; QC PASS butuh uji kasur jadi; tanpa tabel/penulis stok baru", () => {
  const src = (f) => fs.readFileSync(path.join(here, "..", "src", f), "utf8");
  assert.match(src("services/productionSettingsService.js"), /QC_GATE_POLICY_V2 = "QC_GATE_V2"/);
  assert.match(src("services/productionWorkshopExecutionCommandService.js"), /qcGatePolicyVersion: await defaultQcGatePolicy[(]tx[)]/); assert.match(src("services/unitCustodyCommandService.js"), /qcGatePolicyVersion: await defaultQcGatePolicy[(]tx[)]/);
  assert.match(src("services/productionWorkshopExecutionCommandService.js"), /hasAssemblyGate = \(run\) => run\?\.qcGatePolicyVersion === QC_GATE_POLICY_V2/);
  assert.match(src("services/productionStepCommandService.js"), /assemblyGate = isLayanan && inModule && hasAssemblyGate\(run\)/);
  assert.match(src("services/productionQcHandoffCommandService.js"), /QC_FINISHED_TEST_REQUIRED/); assert.doesNotMatch(src("services/productionQcHandoffCommandService.js").replace(/\/\/.*$/gm, ""), /productionStepEvidence\.findMany\([^)]*stepNo: \{ in: \[6, 7\]/);
  const note = src("services/productionComponentNoteService.js").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(note, /stockMovement\.(create|update)|materialIssue\.(create|update)|plannedBOMLine\.(create|update)|materialReservation\.(create|update)|productionMaterialReturn\.(create|update)/, "catatan komponen bukan penulis stok/BOM/retur");
  const mig = fs.readFileSync(path.join(here, "..", "prisma", "migrations", "20261025100000_production_component_assembly_tests", "migration.sql"), "utf8");
  assert.match(mig, /'FOUNDATION_TEST_AFTER', 'WHOLE_TEST_AFTER'/); assert.doesNotMatch(mig.replace(/--.*$/gm, ""), /DROP TABLE|DROP COLUMN|DELETE|UPDATE|TRUNCATE/i); assert.doesNotMatch(mig, /\r/);
});
