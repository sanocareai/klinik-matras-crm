import test from "node:test";
import assert from "node:assert/strict";
import {
  assertAssignedOperator, assertExpectedRevision, assertIdempotencyKey, assertRunRevision, materialReadiness, workshopPathOf,
} from "../src/services/productionWorkshopExecutionCommandService.js";

const failsWith = (fn, code, status) => assert.throws(fn, (e) => e.code === code && e.statusCode === status, `harus gagal ${code}`);

test("Idempotency-Key dan expectedRevision wajib; revisi basi -> 409", () => {
  failsWith(() => assertIdempotencyKey("pendek"), "IDEMPOTENCY_KEY_INVALID", 400);
  assert.doesNotThrow(() => assertIdempotencyKey("workshop-test-key-0001"));
  failsWith(() => assertExpectedRevision(undefined), "EXPECTED_REVISION_REQUIRED", 400);
  assert.equal(assertExpectedRevision("4"), 4);
  failsWith(() => assertRunRevision({ revision: 5 }, 4), "WORKSHOP_REVISION_CONFLICT", 409);
  assert.doesNotThrow(() => assertRunRevision({ revision: 4 }, 4));
});

test("jalur workshop = jalur routing sebelum gerbang QC pertama; tanpa gerbang QC atau tanpa tahap sebelumnya ditolak", () => {
  const s = (code, requiresQc = false) => ({ id: code, code, requiresQc });
  const { stages, qcStage } = workshopPathOf([s("a"), s("b"), s("qc", true), s("finish")]);
  assert.deepEqual(stages.map((x) => x.code), ["a", "b"]);
  assert.equal(qcStage.code, "qc");
  failsWith(() => workshopPathOf([s("a"), s("b")]), "WORKSHOP_NO_QC_GATE", 422);
  failsWith(() => workshopPathOf([s("qc", true), s("a")]), "WORKSHOP_EMPTY_PATH", 422);
});

test("operator/work center harus sesuai assignment P3: operator lain 403, workshop lain 422, rencana tanpa assignment 409", () => {
  const plan = { operatorId: "op1", workCenterId: "wc1" };
  assert.doesNotThrow(() => assertAssignedOperator(plan, { id: "op1", active: true }, "wc1"));
  failsWith(() => assertAssignedOperator(plan, { id: "op2", active: true }, "wc1"), "WORKSHOP_OPERATOR_MISMATCH", 403);
  failsWith(() => assertAssignedOperator(plan, null, "wc1"), "WORKSHOP_OPERATOR_MISMATCH", 403);
  failsWith(() => assertAssignedOperator(plan, { id: "op1", active: false }, "wc1"), "WORKSHOP_OPERATOR_MISMATCH", 403);
  failsWith(() => assertAssignedOperator(plan, { id: "op1", active: true }, "wc2"), "WORKSHOP_WORK_CENTER_MISMATCH", 422);
  failsWith(() => assertAssignedOperator(plan, { id: "op1", active: true }, undefined), "WORKSHOP_WORK_CENTER_MISMATCH", 422);
  failsWith(() => assertAssignedOperator({}, { id: "op1", active: true }, "wc1"), "WORKSHOP_PLAN_NOT_ASSIGNED", 409);
});

test("materialReadiness: siap hanya bila MATERIAL_RESERVED + issue ISSUED + tanpa reservasi ACTIVE + tiap baris BOM CONSUMED", () => {
  const plan = { status: "MATERIAL_RESERVED", bomLines: [{ id: "b1" }, { id: "b2" }] };
  const ok = materialReadiness({ plan, issuedCount: 1, activeReservations: 0, consumedBomLineIds: new Set(["b1", "b2"]) });
  assert.deepEqual(ok, { ready: true, reason: null });
  assert.equal(materialReadiness({ plan: { ...plan, status: "PLANNED" }, issuedCount: 1, activeReservations: 0, consumedBomLineIds: new Set(["b1", "b2"]) }).ready, false);
  assert.match(materialReadiness({ plan, issuedCount: 0, activeReservations: 0, consumedBomLineIds: new Set() }).reason, /belum diserahkan/i);
  assert.match(materialReadiness({ plan, issuedCount: 1, activeReservations: 1, consumedBomLineIds: new Set(["b1", "b2"]) }).reason, /belum dikonsumsi/i);
  assert.match(materialReadiness({ plan, issuedCount: 1, activeReservations: 0, consumedBomLineIds: new Set(["b1"]) }).reason, /tanpa reservasi CONSUMED/i);
  assert.equal(materialReadiness({ plan: null, issuedCount: 1, activeReservations: 0, consumedBomLineIds: new Set() }).ready, false);
});
