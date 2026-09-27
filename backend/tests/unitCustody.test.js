import test from "node:test";
import assert from "node:assert/strict";
import {
  ALLOWED_LOCATION_TYPES, assertCanDecide, assertExpectedRevision, assertIdempotencyKey, assertLocationAllowed,
} from "../src/services/unitCustodyCommandService.js";
import {
  PRODUCTION_WRITER_MODE, V2_FLAGS, isProductionWriterEnabledFor, resolveProductionWriterState,
} from "../src/services/v2FeatureFlags.js";

const flags = (enabled, config = {}) => ({ [V2_FLAGS.PRODUCTION_WRITER]: { key: V2_FLAGS.PRODUCTION_WRITER, enabled, config } });
const failsWith = (fn, code, status) => assert.throws(fn, (error) => error.code === code && error.statusCode === status, `harus gagal ${code}`);

test("writer produksi: flag OFF -> OFF; ON tanpa unitIds -> GLOBAL legacy; ON dengan unitIds -> COHORT fail-closed", () => {
  const off = resolveProductionWriterState(flags(false, { unitIds: ["u1"] }));
  assert.equal(off.mode, PRODUCTION_WRITER_MODE.OFF);
  assert.equal(isProductionWriterEnabledFor(off, "u1"), false);

  const global = resolveProductionWriterState(flags(true));
  assert.equal(global.mode, PRODUCTION_WRITER_MODE.GLOBAL);
  assert.equal(isProductionWriterEnabledFor(global, "apa-saja"), true);

  const cohort = resolveProductionWriterState(flags(true, { unitIds: ["u1", "u1", "u2"] }));
  assert.equal(cohort.mode, PRODUCTION_WRITER_MODE.COHORT);
  assert.equal(isProductionWriterEnabledFor(cohort, "u1"), true);
  assert.equal(isProductionWriterEnabledFor(cohort, "u3"), false, "unit di luar cohort -> V1-only");
  assert.equal(isProductionWriterEnabledFor(cohort, null), false, "tanpa unitId -> V1-only (fail-closed)");
  assert.equal(isProductionWriterEnabledFor(cohort, undefined), false);
});

test("writer produksi: flag hilang / tabel tidak tersedia -> OFF", () => {
  assert.equal(resolveProductionWriterState({}).mode, PRODUCTION_WRITER_MODE.OFF);
  assert.equal(resolveProductionWriterState({ [V2_FLAGS.PRODUCTION_WRITER]: { enabled: true, config: { unitIds: [] } } }).mode, PRODUCTION_WRITER_MODE.GLOBAL);
});

test("hanya handoff OFFERED yang dapat diputuskan; double accept/reject dan revisi basi ditolak", () => {
  assert.doesNotThrow(() => assertCanDecide({ status: "OFFERED", revision: 3 }, 3));
  for (const status of ["ACCEPTED", "REJECTED", "CANCELLED", "SUPERSEDED"]) {
    failsWith(() => assertCanDecide({ status, revision: 2 }, 2), "CUSTODY_NOT_OFFERED", 409);
  }
  failsWith(() => assertCanDecide({ status: "OFFERED", revision: 4 }, 3), "CUSTODY_REVISION_CONFLICT", 409);
});

test("lokasi wajib valid, aktif, dan sesuai arah serah-terima", () => {
  failsWith(() => assertLocationAllowed("INBOUND", null), "CUSTODY_LOCATION_INVALID", 422);
  failsWith(() => assertLocationAllowed("INBOUND", { active: false, locationType: "RECEIVING_AREA", code: "A" }), "CUSTODY_LOCATION_INVALID", 422);
  failsWith(() => assertLocationAllowed("INBOUND", { active: true, locationType: "DISPATCH_AREA", code: "D1" }), "CUSTODY_LOCATION_TYPE_INVALID", 422);
  failsWith(() => assertLocationAllowed("RETURN", { active: true, locationType: "RAW_MATERIAL_AREA", code: "R1" }), "CUSTODY_LOCATION_TYPE_INVALID", 422);
  for (const type of ALLOWED_LOCATION_TYPES.INBOUND) assert.doesNotThrow(() => assertLocationAllowed("INBOUND", { active: true, locationType: type, code: "X" }));
  for (const type of ALLOWED_LOCATION_TYPES.RETURN) assert.doesNotThrow(() => assertLocationAllowed("RETURN", { active: true, locationType: type, code: "X" }));
});

test("Idempotency-Key dan expectedRevision wajib; pesan berbahasa Indonesia", () => {
  failsWith(() => assertIdempotencyKey(undefined), "IDEMPOTENCY_KEY_INVALID", 400);
  failsWith(() => assertIdempotencyKey("pendek"), "IDEMPOTENCY_KEY_INVALID", 400);
  assert.doesNotThrow(() => assertIdempotencyKey("custody-test-key-0001"));
  failsWith(() => assertExpectedRevision(undefined), "EXPECTED_REVISION_REQUIRED", 400);
  failsWith(() => assertExpectedRevision("abc"), "EXPECTED_REVISION_REQUIRED", 400);
  failsWith(() => assertExpectedRevision(0), "EXPECTED_REVISION_REQUIRED", 400);
  assert.equal(assertExpectedRevision("2"), 2);
  assert.throws(() => assertCanDecide({ status: "ACCEPTED", revision: 2 }, 2), /Handoff sudah berstatus ACCEPTED/);
  assert.throws(() => assertLocationAllowed("INBOUND", null), /Lokasi penyimpanan tidak valid/);
});
