// Fase 2 Produksi LAYANAN — QC sebelum bongkar, lapisan awal, uji fondasi awal: aturan murni (normalisasi, hitung server, total lapisan, gerbang tahap, pemisahan pengukuran).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  COMPONENT_SECTIONS, QC_SECTION_KEYS, buildMeasurements, isQcSection, normalizeFoundationTest, normalizeMediaItems, normalizeSectionData, summarizeLayers,
} from "../src/lib/domain/productionComponents.js";
import { deriveNextAction, validateStepEvidence } from "../src/lib/domain/productionSteps.js";
import { measurementMessageLines } from "../src/services/productionComponentNoteService.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const code = (fn) => { try { fn(); return null; } catch (e) { return e.code; } };
const kindOf = (u) => (u.startsWith("/media/production-evidence/") ? (/\.(mp4|webm|mov)$/.test(u) ? "video" : "image") : null);
const WHOLE = { complaintMatch: "SEBAGIAN", feelNote: "tengah amblas", testerWeightKg: 75, testMethod: "berbaring di tengah", wholeDropCm: 4, qcInFrame: true };
const FOUND = { system: "BONNELL", unloadedHeightCm: 25, loadedHeightCm: 15, testerWeightKg: 75, testMethod: "beban di tengah rangka" };

test("seksi pengujian: hanya QC_SECTION_KEYS yang QC; seksi lama tidak berubah", () => {
  assert.deepEqual(QC_SECTION_KEYS, ["WHOLE_TEST_BEFORE", "FOUNDATION_TEST_BEFORE", "FOUNDATION_TEST_AFTER", "WHOLE_TEST_AFTER"]);
  assert.equal(isQcSection("LAYERS_BEFORE"), false); assert.equal(isQcSection("WHOLE_TEST_BEFORE"), true);
  assert.deepEqual(Object.keys(COMPONENT_SECTIONS).slice(0, 3), ["LAYERS_BEFORE", "FOUNDATION_BEFORE", "AFTER"]);
});

test("QC sebelum bongkar: berat penguji aktual WAJIB diketik (tidak ada default/otomatis), 0 cm penurunan sah, kosong = ditolak bukan 0", () => {
  const ok = normalizeSectionData("WHOLE_TEST_BEFORE", WHOLE);
  assert.deepEqual([ok.complaintMatch, ok.testerWeightKg, ok.wholeDropCm, ok.qcInFrame], ["SEBAGIAN", 75, 4, true]);
  assert.equal(normalizeSectionData("WHOLE_TEST_BEFORE", { ...WHOLE, wholeDropCm: 0 }).wholeDropCm, 0, "0 cm = hasil ukur sah");
  assert.equal(normalizeSectionData("WHOLE_TEST_BEFORE", { ...WHOLE, wholeDropCm: "3,5", testerWeightKg: "72,5" }).wholeDropCm, 3.5);
  for (const [over, c] of [
    [{ testerWeightKg: undefined }, "COMPONENT_TESTER_WEIGHT_REQUIRED"], [{ testerWeightKg: "" }, "COMPONENT_TESTER_WEIGHT_REQUIRED"], [{ testerWeightKg: 0 }, "COMPONENT_TESTER_WEIGHT_REQUIRED"],
    [{ testerWeightKg: 301 }, "COMPONENT_TESTER_WEIGHT_REQUIRED"], [{ wholeDropCm: undefined }, "COMPONENT_WHOLE_DROP_REQUIRED"], [{ wholeDropCm: -1 }, "COMPONENT_WHOLE_DROP_REQUIRED"],
    [{ complaintMatch: "ENTAH" }, "COMPONENT_COMPLAINT_MATCH_REQUIRED"], [{ feelNote: "ab" }, "COMPONENT_FEEL_REQUIRED"], [{ testMethod: "x" }, "COMPONENT_TEST_METHOD_REQUIRED"],
    [{ qcInFrame: false }, "COMPONENT_QC_IN_FRAME_REQUIRED"],
  ]) assert.equal(code(() => normalizeSectionData("WHOLE_TEST_BEFORE", { ...WHOLE, ...over })), c, JSON.stringify(over));
});

test("uji fondasi awal: penurunan = tanpa beban − dibebani DIHITUNG SERVER (nilai klien diabaikan); dibebani lebih tinggi ditolak; contoh 25→15 = 10 cm tanpa kategori otomatis", () => {
  const f = normalizeSectionData("FOUNDATION_TEST_BEFORE", { ...FOUND, dropCm: 99, category: "AMBLAS" });
  assert.equal(f.dropCm, 10); assert.equal("category" in f, false, "tidak ada kategori otomatis");
  assert.equal(normalizeFoundationTest({ ...FOUND, unloadedHeightCm: "25,5", loadedHeightCm: "15,25" }, null).dropCm, 10.25);
  assert.equal(normalizeFoundationTest({ ...FOUND, loadedHeightCm: 25 }, null).dropCm, 0);
  for (const [over, c] of [[{ loadedHeightCm: 26 }, "COMPONENT_LOADED_TALLER"], [{ unloadedHeightCm: undefined }, "COMPONENT_UNLOADED_HEIGHT_REQUIRED"], [{ loadedHeightCm: 0 }, "COMPONENT_LOADED_HEIGHT_REQUIRED"],
    [{ system: "" }, "COMPONENT_SYSTEM_REQUIRED"], [{ system: "AJAIB" }, "COMPONENT_SYSTEM_INVALID"], [{ testerWeightKg: undefined }, "COMPONENT_TESTER_WEIGHT_REQUIRED"], [{ testMethod: "" }, "COMPONENT_TEST_METHOD_REQUIRED"]]) {
    assert.equal(code(() => normalizeSectionData("FOUNDATION_TEST_BEFORE", { ...FOUND, ...over })), c, JSON.stringify(over));
  }
});

test("lapisan awal: total hanya dari ketebalan yang diketahui; ada yang kosong = 'belum lengkap'; kosong semua/tidak diketahui = Belum dicatat, bukan 0", () => {
  const L = (t) => ({ material: { kind: "UNKNOWN" }, thicknessCm: t, condition: "BAIK", note: null });
  const full = summarizeLayers({ layers: [L(6), L(4)] });
  assert.deepEqual([full.totalThicknessCm, full.totalComplete, full.count], [10, true, 2]); assert.match(full.label, /Total tinggi lapisan 10 cm \(2 lapisan\)/);
  const partial = summarizeLayers({ layers: [L(6), L(null), L(4)] });
  assert.deepEqual([partial.totalThicknessCm, partial.totalComplete, partial.unknownThicknessCount], [10, false, 1]); assert.match(partial.label, /belum lengkap.*1 lapisan belum diukur/);
  const none = summarizeLayers({ layers: [L(null)] });
  assert.equal(none.totalThicknessCm, null); assert.match(none.label, /belum dicatat/);
  assert.equal(summarizeLayers({ layersUnknown: true, layers: [] }).totalThicknessCm, null);
  assert.equal(summarizeLayers(null), null);
  assert.equal(summarizeLayers({ layers: [L(2.5), L(1.25)] }).totalThicknessCm, 3.75);
});

test("media: seksi pengujian & lapisan boleh VIDEO; seksi lama tetap foto saja; tautan lapisan harus ada; maksimal per seksi", () => {
  const v = "/media/production-evidence/a.mp4"; const i = "/media/production-evidence/b.png";
  assert.deepEqual(normalizeMediaItems([v, i], { kindOf, section: "WHOLE_TEST_BEFORE" }).map((m) => m.kind), ["video", "image"]);
  assert.equal(code(() => normalizeMediaItems([v], { kindOf, section: "AFTER" })), "COMPONENT_MEDIA_INVALID", "seksi lama: video ditolak");
  assert.equal(code(() => normalizeMediaItems([v], { kindOf })), "COMPONENT_MEDIA_INVALID");
  assert.equal(normalizeMediaItems([{ url: v, layerOrder: 2 }], { kindOf, section: "LAYERS_BEFORE", layerCount: 2 })[0].layerOrder, 2);
  assert.equal(code(() => normalizeMediaItems([{ url: v, layerOrder: 3 }], { kindOf, section: "LAYERS_BEFORE", layerCount: 2 })), "COMPONENT_MEDIA_LAYER_INVALID");
  assert.equal(code(() => normalizeMediaItems([{ url: i, layerOrder: 1 }], { kindOf, section: "WHOLE_TEST_BEFORE", layerCount: 2 })), "COMPONENT_MEDIA_LAYER_INVALID", "tautan lapisan hanya untuk catatan lapisan");
  const many = (n) => Array.from({ length: n }, (_, k) => `/media/production-evidence/${k}.png`);
  assert.equal(normalizeMediaItems(many(12), { kindOf, section: "FOUNDATION_TEST_BEFORE" }).length, 12);
  assert.equal(code(() => normalizeMediaItems(many(13), { kindOf, section: "FOUNDATION_TEST_BEFORE" })), "COMPONENT_TOO_MANY_MEDIA");
  assert.equal(code(() => normalizeMediaItems(many(9), { kindOf, section: "AFTER" })), "COMPONENT_TOO_MANY_MEDIA");
});

test("pengukuran TERPISAH: kasur utuh, lapisan, fondasi tidak dijumlahkan; tanpa estimasi gabungan/kategori; data kosong = Belum dicatat", () => {
  const empty = buildMeasurements({});
  assert.deepEqual(empty.recorded, { whole: false, foundation: false, layers: false, wholeAfter: false, foundationAfter: false }); assert.equal(empty.combinedEstimate, null);
  const m = buildMeasurements({
    wholeTest: { version: 1, data: normalizeSectionData("WHOLE_TEST_BEFORE", WHOLE) }, foundationTest: { version: 2, data: normalizeSectionData("FOUNDATION_TEST_BEFORE", FOUND) },
    layersBefore: { version: 1, data: { layers: [{ material: { kind: "UNKNOWN" }, thicknessCm: 6, condition: "BAIK" }, { material: { kind: "UNKNOWN" }, thicknessCm: 4, condition: "BAIK" }] } },
  });
  assert.equal(m.whole.wholeDropCm, 4); assert.equal(m.foundation.dropCm, 10); assert.equal(m.layers.totalThicknessCm, 10);
  const keys = JSON.stringify(m);
  assert.doesNotMatch(keys, /"total(Drop|Penurunan)"|"sum"|"amblas"|"category"|"kategori"/i);
  assert.equal(m.combinedEstimate, null); assert.match(m.separationNote, /TIDAK dijumlahkan/);
  const lines = measurementMessageLines(m).join("\n");
  assert.match(lines, /penurunan kasur utuh 4 cm/); assert.match(lines, /penurunan fondasi 10 cm/); assert.match(lines, /tidak dijumlahkan/); assert.doesNotMatch(lines, /amblas \d/i);
  assert.match(measurementMessageLines(buildMeasurements({ wholeTest: { version: 1, data: normalizeSectionData("WHOLE_TEST_BEFORE", WHOLE) } })).join("\n"), /Uji Fondasi\s+: Belum dicatat/);
  assert.deepEqual(measurementMessageLines(empty), []);
});

const base = (over = {}) => ({
  runStatus: "ACTIVE", currentPhase: "INTAKE", unitStatus: "IN_PRODUCTION", handoffPhaseStatus: null, exceptionOpen: false, target: null, opEvidence: [], step9SinceQc: false, openShortage: false,
  serviceSet: false, pathHasModules: false, materialReady: true, buildTrack: false, preTeardownGate: true, ...over,
});
const op = (stageCode, extra = {}) => ({ stageCode, stagePhase: "INTAKE", stageSequence: 1, status: "ACTIVE", isLastPreQc: false, isPostQc: false, ...extra });

test("gerbang tahap: 2 & 4 menunggu PIC QC lalu 'Lanjutkan' satu ketuk; 3 menuntut lapisan awal; adaptasi/NEW/SEWA/QC tidak terkena gerbang", () => {
  const w2 = deriveNextAction(base({ activeOp: op("pre_teardown_test") }));
  assert.deepEqual([w2.action, w2.wait, w2.actor, w2.stepNo], ["WAIT", "QC_BEFORE_PENDING", "QC", 2]);
  assert.deepEqual(deriveNextAction(base({ activeOp: op("pre_teardown_test"), qcBeforeRecorded: true })), { actor: "TABLE", stepNo: 2, action: "COMPLETE", continueOnly: true, qcRecorded: true });
  const t3 = deriveNextAction(base({ activeOp: op("teardown") }));
  assert.deepEqual([t3.action, t3.stepNo, t3.gated, t3.layersRequired], ["COMPLETE", 3, true, true]);
  const t3ok = deriveNextAction(base({ activeOp: op("teardown"), layersBeforeRecorded: true })); assert.equal(t3ok.layersRequired, undefined); assert.equal(t3ok.gated, true);
  assert.equal(deriveNextAction(base({ activeOp: op("foundation_test") })).wait, "FOUNDATION_TEST_PENDING");
  assert.equal(deriveNextAction(base({ activeOp: op("foundation_test"), foundationTestRecorded: true })).continueOnly, true);
  // di luar gerbang: perilaku lama (adaptasi / SEWA / non-intake)
  for (const code of ["pre_teardown_test", "teardown", "foundation_test"]) {
    const legacy = deriveNextAction(base({ preTeardownGate: false, activeOp: op(code) }));
    assert.equal(legacy.action, "COMPLETE"); assert.equal(legacy.gated, undefined); assert.equal(legacy.continueOnly, undefined);
  }
  assert.equal(deriveNextAction(base({ activeOp: op("diagnosis") })).stepNo, 5, "diagnosa tidak terkena gerbang");
});

test("validator gerbang: tahap 2/4 hanya menaut versi catatan QC; tahap 3 butuh lapisan + media dokumentasi; tanpa gerbang = bukti lama persis", () => {
  const ctx = { preTeardownGate: true, gateRefs: { wholeTest: { version: 2 }, layers: { version: 1, layersUnknown: false }, foundationTest: { version: 3 } } };
  assert.deepEqual(validateStepEvidence(2, { payload: {}, media: [] }, ctx).payload, { qcRef: { section: "WHOLE_TEST_BEFORE", version: 2 } });
  assert.equal(validateStepEvidence(4, { payload: { foundationIssues: ["Per tengah lemah"] }, media: [] }, ctx).payload.qcRef.version, 3);
  assert.equal(code(() => validateStepEvidence(2, { payload: {} }, { preTeardownGate: true, gateRefs: {} })), "STEP_WAITING_QC_BEFORE_PENDING");
  assert.equal(code(() => validateStepEvidence(4, { payload: {} }, { preTeardownGate: true, gateRefs: {} })), "STEP_WAITING_FOUNDATION_TEST_PENDING");
  assert.equal(code(() => validateStepEvidence(3, { payload: {}, media: [{ url: "/media/production-evidence/" + "a".repeat(40) + ".jpg" }] }, { preTeardownGate: true, gateRefs: {} })), "STEP_LAYERS_REQUIRED");
  assert.equal(code(() => validateStepEvidence(3, { payload: {}, media: [] }, ctx)), "STEP_EVIDENCE_INVALID", "dokumentasi bongkar tetap wajib media");
  const ok3 = validateStepEvidence(3, { payload: {}, media: [{ url: "/media/production-evidence/" + "a".repeat(40) + ".jpg" }] }, ctx);
  assert.deepEqual(ok3.payload.layersRef, { section: "LAYERS_BEFORE", version: 1, layersUnknown: false }); assert.deepEqual(ok3.payload.oldMaterials, []);
  // bukti lama (tanpa gerbang) tetap valid dan ketat
  assert.equal(code(() => validateStepEvidence(2, { payload: { feelNote: "empuk" }, media: [{ url: "/media/production-evidence/" + "b".repeat(40) + ".jpg" }] })), "STEP_EVIDENCE_INVALID");
  assert.equal(code(() => validateStepEvidence(4, { payload: { heightBeforeCm: 20, heightCompressedCm: 25, testerWeightKg: 80 }, media: [{ url: "/media/production-evidence/" + "c".repeat(40) + ".mp4" }] })), "STEP_EVIDENCE_INVALID");
});

test("tidak menyentuh BOM/stok/reservasi/issue/retur dan tidak menambah stage engine paralel (audit statis)", () => {
  const read = (...p) => fs.readFileSync(path.join(here, "..", "src", ...p), "utf8").replace(/\/\/.*$/gm, "");
  for (const f of [["lib", "domain", "productionComponents.js"], ["services", "productionComponentNoteService.js"], ["routes", "productionComponentNotes.js"]]) {
    assert.doesNotMatch(read(...f), /stockMovement|stockBalance|materialReservation|materialIssue|productionMaterialReturn|plannedBom|\.bom\b/i, f.join("/"));
  }
  const steps = read("lib", "domain", "productionSteps.js");
  assert.equal((steps.match(/pre_teardown_test/g) || []).length >= 1, true);
  assert.doesNotMatch(read("services", "productionComponentNoteService.js"), /productionOperationRun|productionPhaseRun|applyStartInTx|applyCompleteInTx/, "tidak ada transisi tahap di layanan catatan komponen");
});
