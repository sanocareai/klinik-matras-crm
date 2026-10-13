// Pemisahan PIC Meja Bongkar vs PIC Corner & Finishing — tes unit murni (tanpa DB): kosakata lini, normalisasi ketat, dan
// bahwa PIC Corner tidak lagi jatuh ke PIC Meja pada penjaga eksekusi Corner.
import test from "node:test";
import assert from "node:assert/strict";
import { WORK_LANES, WORK_LANE_VALUES, hasLane, lanesOf, normalizeWorkLanes } from "../src/lib/domain/productionLanes.js";
import { assertAssignedCornerOperator } from "../src/services/productionWorkshopExecutionCommandService.js";
import { assertOperatorLane } from "../src/services/productionPlanningCommandService.js";

test("normalizeWorkLanes: hanya TABLE/CORNER; duplikat dibuang; urutan baku; nilai asing/bukan array ditolak (bukan ditebak)", () => {
  assert.deepEqual(normalizeWorkLanes([]), []);
  assert.deepEqual(normalizeWorkLanes(["CORNER", "TABLE", "CORNER"]), ["TABLE", "CORNER"]);
  assert.deepEqual(normalizeWorkLanes(["CORNER"]), ["CORNER"]);
  for (const bad of [null, undefined, "TABLE", { TABLE: true }, ["TABLE", "MEJA"], ["table"], [1], [null], ["QC"]]) assert.equal(normalizeWorkLanes(bad), null, JSON.stringify(bad));
  assert.deepEqual([...WORK_LANE_VALUES], ["TABLE", "CORNER"]);
});

test("lanesOf/hasLane: membaca toleran; operator tanpa lini (bermula kosong) tidak punya lini apa pun", () => {
  assert.deepEqual(lanesOf({ workLanes: ["CORNER", "XYZ"] }), ["CORNER"]);
  assert.deepEqual(lanesOf({}), []); assert.deepEqual(lanesOf(null), []); assert.deepEqual(lanesOf({ workLanes: "TABLE" }), []);
  assert.equal(hasLane({ workLanes: [] }, WORK_LANES.TABLE), false);
  assert.equal(hasLane({ workLanes: ["CORNER"] }, WORK_LANES.TABLE), false);
  assert.equal(hasLane({ workLanes: ["CORNER"] }, WORK_LANES.CORNER), true);
});

test("assertOperatorLane: lini tidak cocok => 422 dengan kode; lini cocok lolos", () => {
  assert.doesNotThrow(() => assertOperatorLane({ id: "a", workLanes: ["TABLE"] }, WORK_LANES.TABLE));
  assert.throws(() => assertOperatorLane({ id: "a", workLanes: ["CORNER"] }, WORK_LANES.TABLE), (e) => e.statusCode === 422 && e.code === "PLAN_OPERATOR_LANE_INVALID");
  assert.throws(() => assertOperatorLane({ id: "a", workLanes: [] }, WORK_LANES.CORNER, { code: "CORNER_OPERATOR_LANE_INVALID" }), (e) => e.statusCode === 422 && e.code === "CORNER_OPERATOR_LANE_INVALID");
});

test("PIC Corner kosong => TOLAK (409 CORNER_OPERATOR_REQUIRED), TIDAK jatuh ke PIC Meja — walau operator yang mencoba adalah PIC Meja", () => {
  const plan = { operatorId: "meja", cornerOperatorId: null, workCenterId: "wc", cornerWorkCenterId: null };
  assert.throws(() => assertAssignedCornerOperator(plan, { id: "meja", active: true }, "wc"), (e) => e.statusCode === 409 && e.code === "CORNER_OPERATOR_REQUIRED");
  assert.throws(() => assertAssignedCornerOperator(plan, null, "wc"), (e) => e.code === "CORNER_OPERATOR_REQUIRED");
});

test("PIC Corner terisi: hanya PIC Corner itu yang lolos; PIC Meja ditolak 403", () => {
  const plan = { operatorId: "meja", cornerOperatorId: "corner", workCenterId: "wc", cornerWorkCenterId: null };
  assert.doesNotThrow(() => assertAssignedCornerOperator(plan, { id: "corner", active: true }, "wc"));
  assert.throws(() => assertAssignedCornerOperator(plan, { id: "meja", active: true }, "wc"), (e) => e.statusCode === 403 && e.code === "WORKSHOP_OPERATOR_MISMATCH");
});
