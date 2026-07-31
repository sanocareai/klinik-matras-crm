// Tes jalur produksi — logika MURNI, tanpa database. Ini inti "routing
// adalah data, bukan kode" (D-003): tes ini membuktikan jalur unit dihitung
// benar dari data routing_stages + service_catalog_modules, TANPA satu pun
// perbandingan nama tahap di kode produksinya.

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildUnitPath,
  getNextStage,
  isLastStage,
  isLastIntakeStage,
  findComfortLayerModule,
} from "../src/lib/domain/routing.js";

// Data uji meniru bentuk RoutingStage sungguhan (subset field yang relevan).
const intake = [
  { id: "diagnosis", phase: "INTAKE", sequence: 4 },
  { id: "pre_teardown_test", phase: "INTAKE", sequence: 1 },
  { id: "teardown", phase: "INTAKE", sequence: 2 },
  { id: "foundation_test", phase: "INTAKE", sequence: 3 },
];
const finish = [
  { id: "finished", phase: "FINISH", sequence: 3 },
  { id: "fit_test", phase: "FINISH", sequence: 1, requiresQc: true },
  { id: "corner_sewing", phase: "FINISH", sequence: 2 },
];

// Modul UPG_FULL: fondasi(10) -> lapisan(20) -> kain(30), SUDAH diurutkan
// sesuai ServiceCatalogModule.sequence (bukan routing_stages.sequence).
const upgFullModules = [
  { id: "foundation_upgrade", phase: "MODULE", sequence: 10 },
  { id: "comfort_layer_upgrade", phase: "MODULE", sequence: 20 },
  { id: "cover_replacement", phase: "MODULE", sequence: 30 },
];

test("buildUnitPath: INTAKE selalu diurut ulang walau input acak", () => {
  const path = buildUnitPath(intake, [], finish);
  const intakeIds = path.filter((s) => s.phase === "INTAKE").map((s) => s.id);
  assert.deepEqual(intakeIds, ["pre_teardown_test", "teardown", "foundation_test", "diagnosis"]);
});

test("buildUnitPath: modul mengikuti urutan katalog layanan, BUKAN routing_stages.sequence", () => {
  // Modul dikirim dalam urutan katalog (fondasi->lapisan->kain untuk UPG_FULL)
  const path = buildUnitPath(intake, upgFullModules, finish);
  const moduleIds = path.filter((s) => s.phase === "MODULE").map((s) => s.id);
  assert.deepEqual(moduleIds, ["foundation_upgrade", "comfort_layer_upgrade", "cover_replacement"]);
});

test("buildUnitPath: jalur penuh SVC_FONDASI (1 modul saja)", () => {
  const svcFondasiModules = [{ id: "foundation_service", phase: "MODULE", sequence: 10 }];
  const path = buildUnitPath(intake, svcFondasiModules, finish);
  assert.equal(path.length, 4 + 1 + 3); // 4 intake + 1 modul + 3 finish
  assert.equal(path[4].id, "foundation_service");
});

test("getNextStage: null (belum masuk produksi) -> tahap pertama", () => {
  const path = buildUnitPath(intake, upgFullModules, finish);
  assert.equal(getNextStage(path, null).id, "pre_teardown_test");
});

test("getNextStage: berjalan lurus lintas fase INTAKE -> MODULE -> FINISH", () => {
  const path = buildUnitPath(intake, upgFullModules, finish);
  assert.equal(getNextStage(path, "pre_teardown_test").id, "teardown");
  assert.equal(getNextStage(path, "diagnosis").id, "foundation_upgrade", "INTAKE terakhir -> MODULE pertama");
  assert.equal(getNextStage(path, "cover_replacement").id, "fit_test", "MODULE terakhir -> FINISH pertama");
  assert.equal(getNextStage(path, "corner_sewing").id, "finished");
});

test("getNextStage: tahap terakhir jalur -> null (unit selesai)", () => {
  const path = buildUnitPath(intake, upgFullModules, finish);
  assert.equal(getNextStage(path, "finished"), null);
});

test("getNextStage: stageId di luar jalur (lini/layanan sudah berubah) -> null, bukan salah tebak", () => {
  const path = buildUnitPath(intake, upgFullModules, finish);
  assert.equal(getNextStage(path, "tahap_tidak_dikenal"), null);
});

test("isLastStage", () => {
  const path = buildUnitPath(intake, upgFullModules, finish);
  assert.ok(isLastStage(path, "finished"));
  assert.ok(!isLastStage(path, "corner_sewing"));
});

test("findComfortLayerModule: ketemu untuk layanan yang punya modul lapisan", () => {
  const path = buildUnitPath(intake, upgFullModules, finish);
  assert.equal(findComfortLayerModule(path).id, "comfort_layer_upgrade");
});

test("findComfortLayerModule: null untuk layanan TANPA modul lapisan (Service Fondasi murni)", () => {
  const svcFondasiModules = [{ id: "foundation_service", phase: "MODULE", sequence: 10 }];
  const path = buildUnitPath(intake, svcFondasiModules, finish);
  assert.equal(findComfortLayerModule(path), null);
});

test("isLastIntakeStage: benar untuk tahap INTAKE terakhir (dihitung dari fase+urutan, bukan nama kode)", () => {
  const path = buildUnitPath(intake, upgFullModules, finish);
  assert.ok(isLastIntakeStage(path, "diagnosis"));
  assert.ok(!isLastIntakeStage(path, "pre_teardown_test"));
  assert.ok(!isLastIntakeStage(path, "teardown"));
});

test("isLastIntakeStage: false untuk tahap MODULE/FINISH — bukan bagian INTAKE sama sekali", () => {
  const path = buildUnitPath(intake, upgFullModules, finish);
  assert.ok(!isLastIntakeStage(path, "foundation_upgrade"));
  assert.ok(!isLastIntakeStage(path, "fit_test"));
});

test("isLastIntakeStage: tetap benar walau urutan INTAKE diacak — bergantung fase+sequence, bukan posisi array", () => {
  const shuffledIntake = [intake[3], intake[0], intake[2], intake[1]]; // acak
  const path = buildUnitPath(shuffledIntake, upgFullModules, finish);
  assert.ok(isLastIntakeStage(path, "diagnosis"), "diagnosis (sequence=4) tetap terakhir walau input diacak");
});
