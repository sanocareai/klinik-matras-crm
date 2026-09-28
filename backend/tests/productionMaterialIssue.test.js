import test from "node:test";
import assert from "node:assert/strict";
import {
  assertExpectedRevision, assertIdempotencyKey, assertIssueCancellable, assertIssuePickable, assertIssueRevision,
} from "../src/services/productionMaterialIssueCommandService.js";

const failsWith = (fn, code, status) => assert.throws(fn, (e) => e.code === code && e.statusCode === status, `harus gagal ${code}`);

test("Idempotency-Key dan expectedRevision wajib", () => {
  failsWith(() => assertIdempotencyKey("pendek"), "IDEMPOTENCY_KEY_INVALID", 400);
  assert.doesNotThrow(() => assertIdempotencyKey("issue-test-key-0001"));
  failsWith(() => assertExpectedRevision(undefined), "EXPECTED_REVISION_REQUIRED", 400);
  failsWith(() => assertExpectedRevision(0), "EXPECTED_REVISION_REQUIRED", 400);
  assert.equal(assertExpectedRevision("2"), 2);
});

test("hanya READY_TO_PICK yang dapat diserahkan; ISSUED/CANCELLED terminal; revisi basi 409", () => {
  assert.doesNotThrow(() => assertIssuePickable({ status: "READY_TO_PICK" }));
  failsWith(() => assertIssuePickable({ status: "ISSUED" }), "MATERIAL_ISSUE_ALREADY_PICKED", 409);
  failsWith(() => assertIssuePickable({ status: "CANCELLED" }), "MATERIAL_ISSUE_CANCELLED", 409);
  failsWith(() => assertIssuePickable({ status: "DRAFT" }), "MATERIAL_ISSUE_NOT_READY", 409);
  failsWith(() => assertIssueRevision({ revision: 3 }, 2), "MATERIAL_ISSUE_REVISION_CONFLICT", 409);
  assert.doesNotThrow(() => assertIssueRevision({ revision: 2 }, 2));
});

test("cancel: boleh sebelum PICKED; setelah ISSUED ditolak (koreksi lewat return/adjustment); CANCELLED terminal", () => {
  assert.doesNotThrow(() => assertIssueCancellable({ status: "READY_TO_PICK" }));
  failsWith(() => assertIssueCancellable({ status: "ISSUED" }), "MATERIAL_ISSUE_ALREADY_PICKED", 409);
  assert.throws(() => assertIssueCancellable({ status: "ISSUED" }), /return\/adjustment/);
  failsWith(() => assertIssueCancellable({ status: "CANCELLED" }), "MATERIAL_ISSUE_CANCELLED", 409);
});
