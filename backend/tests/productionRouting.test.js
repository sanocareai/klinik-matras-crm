// Tes Production Core Slice 4 — lib/domain/productionRouting.js (fungsi
// MURNI, tanpa database) DAN services/productionRouting.js#resolveOrCreateActiveRoute/
// tryProvisionUnitRoute (lewat stub `tx` — pola SAMA dengan
// loadLastCurrentStageLogs di tests/queryBatching.test.js: fungsi-fungsi
// ini menerima `tx`/`client` sebagai parameter, jadi bisa dites TANPA
// database sungguhan dengan objek stub berbentuk-Prisma).
//
// changeUnitRoute()/assignStage() SENGAJA TIDAK dites di sini — dua-duanya
// membungkus prisma.$transaction() SENDIRI (bukan menerima `tx` dari
// pemanggil), jadi diverifikasi lewat code review + pemeriksaan manual
// pasca-deploy, pola yang SAMA dipakai untuk failStage()/resolveBlocker()
// di unitStageEngine.js sejak Slice 2/3.

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRouteStageSnapshot, canReplaceRoute, mapRouteStagesToVisualization,
  deriveSkillWarning, resolveEffectiveWorkCenterId, OPERATOR_SKILL_LEVELS,
} from "../src/lib/domain/productionRouting.js";
import { resolveOrCreateActiveRoute, tryProvisionUnitRoute } from "../src/services/productionRouting.js";

// ---------------------------------------------------------------------------
// buildRouteStageSnapshot
// ---------------------------------------------------------------------------

test("buildRouteStageSnapshot: sequence deterministik mengikuti urutan path, required = !isOptional", () => {
  const path = [
    { id: "s1", isOptional: false, defaultWorkCenterId: "wc1" },
    { id: "s2", isOptional: true, defaultWorkCenterId: null },
    { id: "s3", isOptional: false },
  ];
  const rows = buildRouteStageSnapshot(path);
  assert.deepEqual(rows, [
    { stageId: "s1", sequence: 1, required: true, workCenterId: "wc1" },
    { stageId: "s2", sequence: 2, required: false, workCenterId: null },
    { stageId: "s3", sequence: 3, required: true, workCenterId: null },
  ]);
});

test("buildRouteStageSnapshot: path kosong -> array kosong, bukan error", () => {
  assert.deepEqual(buildRouteStageSnapshot([]), []);
  assert.deepEqual(buildRouteStageSnapshot(null), []);
});

test("buildRouteStageSnapshot: urutan SELALU sama untuk path yang sama (deterministik)", () => {
  const path = [{ id: "a", isOptional: false }, { id: "b", isOptional: false }, { id: "c", isOptional: true }];
  const r1 = buildRouteStageSnapshot(path);
  const r2 = buildRouteStageSnapshot(path);
  assert.deepEqual(r1, r2);
  assert.deepEqual(r1.map((r) => r.sequence), [1, 2, 3]);
});

// ---------------------------------------------------------------------------
// canReplaceRoute — guardrail Slice 4Q
// ---------------------------------------------------------------------------

test("canReplaceRoute: boleh diganti kalau BELUM ada riwayat eksekusi", () => {
  assert.equal(canReplaceRoute({ hasExecutionHistory: false }), true);
});

test("canReplaceRoute: TIDAK boleh diganti kalau SUDAH ada riwayat eksekusi", () => {
  assert.equal(canReplaceRoute({ hasExecutionHistory: true }), false);
});

// ---------------------------------------------------------------------------
// mapRouteStagesToVisualization
// ---------------------------------------------------------------------------

test("mapRouteStagesToVisualization: DONE/SKIPPED -> marker DONE, tahap sekarang -> CURRENT, sisanya PENDING", () => {
  const routeStages = [
    { stageId: "s1", sequence: 1 },
    { stageId: "s2", sequence: 2 },
    { stageId: "s3", sequence: 3 },
    { stageId: "s4", sequence: 4 },
  ];
  const liveStatus = { s1: "DONE", s2: "SKIPPED", s3: "IN_PROGRESS", s4: "NOT_STARTED" };
  const result = mapRouteStagesToVisualization(routeStages, liveStatus, "s3");
  assert.deepEqual(result.map((r) => r.marker), ["DONE", "DONE", "CURRENT", "PENDING"]);
});

test("mapRouteStagesToVisualization: urut ulang berdasarkan sequence walau input tidak terurut", () => {
  const routeStages = [{ stageId: "b", sequence: 2 }, { stageId: "a", sequence: 1 }];
  const result = mapRouteStagesToVisualization(routeStages, {}, null);
  assert.deepEqual(result.map((r) => r.stageId), ["a", "b"]);
});

test("mapRouteStagesToVisualization: stageId tidak ada di live status -> UNKNOWN, bukan disembunyikan", () => {
  const result = mapRouteStagesToVisualization([{ stageId: "ghost", sequence: 1 }], {}, null);
  assert.equal(result.length, 1);
  assert.equal(result[0].status, "UNKNOWN");
});

test("mapRouteStagesToVisualization: array kosong/null aman", () => {
  assert.deepEqual(mapRouteStagesToVisualization([], {}, null), []);
  assert.deepEqual(mapRouteStagesToVisualization(null, {}, null), []);
});

// ---------------------------------------------------------------------------
// deriveSkillWarning — Slice 4G, WARNING bukan blocking
// ---------------------------------------------------------------------------

test("deriveSkillWarning: operator punya skill aktif untuk tahap ini -> hasSkill true, tanpa warning", () => {
  const skills = [{ stageId: "spring", level: 4, active: true }];
  const result = deriveSkillWarning(skills, "spring");
  assert.equal(result.hasSkill, true);
  assert.equal(result.level, 4);
  assert.equal(result.warning, null);
});

test("deriveSkillWarning: skill tidak ditemukan -> hasSkill false + warning, TIDAK melempar error", () => {
  const result = deriveSkillWarning([{ stageId: "foam", level: 3, active: true }], "spring");
  assert.equal(result.hasSkill, false);
  assert.equal(result.level, null);
  assert.match(result.warning, /belum punya data skill/);
});

test("deriveSkillWarning: skill ada tapi active=false -> diperlakukan sama seperti tidak ada", () => {
  const result = deriveSkillWarning([{ stageId: "spring", level: 5, active: false }], "spring");
  assert.equal(result.hasSkill, false);
});

test("deriveSkillWarning: data skill kosong/null sama sekali -> tidak melempar, cuma warning (data awal belum lengkap tidak boleh memblokir)", () => {
  assert.doesNotThrow(() => deriveSkillWarning(null, "spring"));
  assert.doesNotThrow(() => deriveSkillWarning([], "spring"));
  assert.equal(deriveSkillWarning([], "spring").hasSkill, false);
});

test("OPERATOR_SKILL_LEVELS: 1 sampai 5", () => {
  assert.deepEqual(OPERATOR_SKILL_LEVELS, [1, 2, 3, 4, 5]);
});

// ---------------------------------------------------------------------------
// resolveEffectiveWorkCenterId — override per-unit MENANG atas default tahap
// ---------------------------------------------------------------------------

test("resolveEffectiveWorkCenterId: assignment.workCenterId menang atas default tahap", () => {
  const wc = resolveEffectiveWorkCenterId({ workCenterId: "wc-override" }, { defaultWorkCenterId: "wc-default" });
  assert.equal(wc, "wc-override");
});

test("resolveEffectiveWorkCenterId: fallback ke default tahap kalau belum ada assignment", () => {
  assert.equal(resolveEffectiveWorkCenterId(null, { defaultWorkCenterId: "wc-default" }), "wc-default");
});

test("resolveEffectiveWorkCenterId: null kalau dua-duanya tidak ada", () => {
  assert.equal(resolveEffectiveWorkCenterId(null, null), null);
  assert.equal(resolveEffectiveWorkCenterId({ workCenterId: null }, { defaultWorkCenterId: null }), null);
});

// ---------------------------------------------------------------------------
// resolveOrCreateActiveRoute / tryProvisionUnitRoute — stub `tx`, tanpa DB
// ---------------------------------------------------------------------------

/** Bangun stub `tx` Prisma-shaped minimal untuk skenario satu layanan. */
function fakeTx({ existingRoute = null, path = [] } = {}) {
  const calls = { productionRouteCreate: 0, unitUpdate: 0, activityEventCreate: 0 };
  const intake = path.filter((s) => s.phase === "INTAKE");
  const modules = path.filter((s) => s.phase === "MODULE");
  const finish = path.filter((s) => s.phase === "FINISH");

  const tx = {
    productionRoute: {
      findFirst: async () => existingRoute,
      aggregate: async () => ({ _max: { version: existingRoute?.version || 0 } }),
      create: async ({ data }) => {
        calls.productionRouteCreate++;
        return { id: "new-route-id", ...data, stages: data.stages.create };
      },
    },
    serviceCatalog: { findUnique: async () => ({ id: "svc-1", code: "SVC_TEST", labelId: "Layanan Tes" }) },
    routingStage: {
      findMany: async ({ where }) => (where.phase === "INTAKE" ? intake : finish),
    },
    serviceCatalogModule: {
      findMany: async () => modules.map((s, i) => ({ sequence: i, stage: s })),
    },
    unit: {
      findUnique: async () => ({ productionRouteId: null }),
      update: async () => { calls.unitUpdate++; },
    },
    unitStageLog: { count: async () => 0 },
    activityEvent: { create: async () => { calls.activityEventCreate++; } },
  };
  return { tx, calls };
}

const STAGE_INTAKE = { id: "st-intake", phase: "INTAKE", sequence: 1, isOptional: false, defaultWorkCenterId: null };
const STAGE_MODULE = { id: "st-module", phase: "MODULE", sequence: 1, isOptional: false, defaultWorkCenterId: "wc-spring" };
const STAGE_FINISH = { id: "st-finish", phase: "FINISH", sequence: 1, isOptional: false, defaultWorkCenterId: null };

test("resolveOrCreateActiveRoute: route aktif SUDAH ADA -> dikembalikan apa adanya, TIDAK membuat baris baru", async () => {
  const existing = { id: "route-1", version: 1, active: true, stages: [] };
  const { tx, calls } = fakeTx({ existingRoute: existing });
  const result = await resolveOrCreateActiveRoute(tx, "svc-1");
  assert.equal(result, existing);
  assert.equal(calls.productionRouteCreate, 0);
});

test("resolveOrCreateActiveRoute: belum ada route -> DIBUAT dari jalur live, stage rows sesuai buildRouteStageSnapshot", async () => {
  const { tx, calls } = fakeTx({ path: [STAGE_INTAKE, STAGE_MODULE, STAGE_FINISH] });
  const result = await resolveOrCreateActiveRoute(tx, "svc-1");
  assert.equal(calls.productionRouteCreate, 1);
  assert.equal(result.version, 1);
  assert.equal(result.code, "SVC_TEST");
  assert.deepEqual(result.stages.map((s) => s.stageId), ["st-intake", "st-module", "st-finish"]);
  assert.equal(result.stages[1].workCenterId, "wc-spring"); // dari STAGE_MODULE.defaultWorkCenterId
});

test("resolveOrCreateActiveRoute: layanan tanpa tahap MODULE sama sekali -> null, TIDAK membuat baris kosong", async () => {
  const { tx, calls } = fakeTx({ path: [] });
  const result = await resolveOrCreateActiveRoute(tx, "svc-1");
  assert.equal(result, null);
  assert.equal(calls.productionRouteCreate, 0);
});

test("tryProvisionUnitRoute: unit BARU (tanpa riwayat eksekusi) -> route terpasang + ROUTE_ASSIGNED diaudit", async () => {
  const { tx, calls } = fakeTx({ path: [STAGE_INTAKE, STAGE_MODULE, STAGE_FINISH] });
  const route = await tryProvisionUnitRoute(tx, "unit-1", "svc-1", "actor-1");
  assert.ok(route);
  assert.equal(calls.unitUpdate, 1);
  assert.equal(calls.activityEventCreate, 1);
});

test("tryProvisionUnitRoute: unit SUDAH punya riwayat eksekusi -> TIDAK menyentuh productionRouteId sama sekali (guardrail Slice 4Q)", async () => {
  const { tx, calls } = fakeTx({ path: [STAGE_INTAKE, STAGE_MODULE, STAGE_FINISH] });
  tx.unitStageLog.count = async () => 3; // sudah ada 3 baris eksekusi
  const result = await tryProvisionUnitRoute(tx, "unit-1", "svc-1", "actor-1");
  assert.equal(result, null);
  assert.equal(calls.unitUpdate, 0);
  assert.equal(calls.activityEventCreate, 0);
  assert.equal(calls.productionRouteCreate, 0, "tidak perlu resolve/create route sama sekali kalau sudah dijamin di-skip");
});

test("tryProvisionUnitRoute: unit sudah menunjuk route yang SAMA -> tidak menulis apa pun lagi (idempotent)", async () => {
  const existing = { id: "route-1", version: 1, active: true, stages: [] };
  const { tx, calls } = fakeTx({ existingRoute: existing });
  tx.unit.findUnique = async () => ({ productionRouteId: "route-1" });
  const result = await tryProvisionUnitRoute(tx, "unit-1", "svc-1", "actor-1");
  assert.equal(result, existing);
  assert.equal(calls.unitUpdate, 0);
  assert.equal(calls.activityEventCreate, 0);
});
