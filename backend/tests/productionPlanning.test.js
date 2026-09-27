import test from "node:test";
import assert from "node:assert/strict";
import {
  assertExpectedRevision, assertIdempotencyKey, assertPlanBOMLines, assertPlanNotCancelled, assertPlanRevision,
} from "../src/services/productionPlanningCommandService.js";

const failsWith = (fn, code, status) => assert.throws(fn, (error) => error.code === code && error.statusCode === status, `harus gagal ${code}`);

test("Idempotency-Key dan expectedRevision wajib; pesan berbahasa Indonesia", () => {
  failsWith(() => assertIdempotencyKey(undefined), "IDEMPOTENCY_KEY_INVALID", 400);
  failsWith(() => assertIdempotencyKey("pendek"), "IDEMPOTENCY_KEY_INVALID", 400);
  assert.doesNotThrow(() => assertIdempotencyKey("plan-test-key-0001"));
  failsWith(() => assertExpectedRevision(undefined), "EXPECTED_REVISION_REQUIRED", 400);
  failsWith(() => assertExpectedRevision("abc"), "EXPECTED_REVISION_REQUIRED", 400);
  failsWith(() => assertExpectedRevision(0), "EXPECTED_REVISION_REQUIRED", 400);
  assert.equal(assertExpectedRevision("3"), 3);
});

test("revisi rencana basi -> 409 PLAN_REVISION_CONFLICT; rencana CANCELLED terminal", () => {
  assert.doesNotThrow(() => assertPlanRevision({ revision: 2 }, 2));
  failsWith(() => assertPlanRevision({ revision: 3 }, 2), "PLAN_REVISION_CONFLICT", 409);
  assert.doesNotThrow(() => assertPlanNotCancelled({ status: "PLANNED" }));
  failsWith(() => assertPlanNotCancelled({ status: "CANCELLED" }), "PLAN_CANCELLED", 409);
  assert.throws(() => assertPlanNotCancelled({ status: "CANCELLED" }), /sudah dibatalkan/);
});

test("Planned BOM: minimal satu baris, qty > 0, tanpa material duplikat", () => {
  failsWith(() => assertPlanBOMLines([]), "PLAN_BOM_EMPTY", 400);
  failsWith(() => assertPlanBOMLines(undefined), "PLAN_BOM_EMPTY", 400);
  failsWith(() => assertPlanBOMLines([{ materialId: "m1", qty: 0 }]), "PLAN_BOM_QTY_INVALID", 400);
  failsWith(() => assertPlanBOMLines([{ materialId: "m1", qty: -1 }]), "PLAN_BOM_QTY_INVALID", 400);
  failsWith(() => assertPlanBOMLines([{ qty: 1 }]), "PLAN_BOM_MATERIAL_REQUIRED", 400);
  failsWith(() => assertPlanBOMLines([{ materialId: "m1", qty: 1 }, { materialId: "m1", qty: 2 }]), "PLAN_BOM_DUPLICATE_MATERIAL", 400);
  assert.doesNotThrow(() => assertPlanBOMLines([{ materialId: "m1", qty: 1 }, { materialId: "m2", qty: 2.5 }]));
});
