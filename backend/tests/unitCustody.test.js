import test from "node:test";
import assert from "node:assert/strict";
import {
  ALLOWED_LOCATION_TYPES, assertCanDecide, assertExpectedRevision, assertIdempotencyKey, assertLocationAllowed,
} from "../src/services/unitCustodyCommandService.js";
import {
  PRODUCTION_READER_MODE, PRODUCTION_WRITER_MODE, V2_FLAGS,
  isProductionReaderEnabledFor, isProductionWriterEnabledFor, resolveProductionReaderState, resolveProductionWriterState,
} from "../src/services/v2FeatureFlags.js";

const flags = (enabled, config = {}) => ({ [V2_FLAGS.PRODUCTION_WRITER]: { key: V2_FLAGS.PRODUCTION_WRITER, enabled, config } });
const readerFlags = (enabled, config = {}) => ({ [V2_FLAGS.PRODUCTION_READER]: { key: V2_FLAGS.PRODUCTION_READER, enabled, config } });
const failsWith = (fn, code, status) => assert.throws(fn, (error) => error.code === code && error.statusCode === status, `harus gagal ${code}`);

const U1 = "81ce67e2-2794-4f2d-a397-9e5a9974aa45";
const U2 = "66e8f0f7-8134-4348-9523-e4b8137c79d1";
const U3 = "bca0c601-d043-46ac-9ef9-14f7a2c505e2";
const quiet = (fn) => { const original = console.warn; console.warn = () => {}; try { return fn(); } finally { console.warn = original; } };

test("writer produksi: flag OFF -> OFF; ON dengan UUID valid+unik -> COHORT; tidak ada mode GLOBAL", () => {
  const off = resolveProductionWriterState(flags(false, { unitIds: [U1] }));
  assert.equal(off.mode, PRODUCTION_WRITER_MODE.OFF);
  assert.equal(off.diagnostic, null);
  assert.equal(isProductionWriterEnabledFor(off, U1), false);

  const cohort = resolveProductionWriterState(flags(true, { unitIds: [U1, U2] }));
  assert.equal(cohort.mode, PRODUCTION_WRITER_MODE.COHORT);
  assert.equal(cohort.diagnostic, null);
  assert.equal(isProductionWriterEnabledFor(cohort, U1), true);
  assert.equal(isProductionWriterEnabledFor(cohort, U2), true);
  assert.equal(isProductionWriterEnabledFor(cohort, U3), false, "unit di luar cohort -> V1-only");
  assert.equal(isProductionWriterEnabledFor(cohort, null), false, "tanpa unitId -> V1-only (fail-closed)");
  assert.equal(isProductionWriterEnabledFor(cohort, undefined), false);
  assert.equal(isProductionWriterEnabledFor(cohort, ""), false);
  assert.equal(isProductionWriterEnabledFor(cohort, 123), false, "unitId bukan string -> V1-only");
  assert.equal(isProductionWriterEnabledFor(resolveProductionWriterState(flags(true, { unitIds: [U1.toUpperCase()] })), U1), true, "UUID dinormalisasi ke huruf kecil");
  assert.equal(PRODUCTION_WRITER_MODE.GLOBAL, undefined, "GLOBAL sudah dihapus dari kontrak");
  assert.equal(PRODUCTION_READER_MODE.GLOBAL, undefined);
});

const MALFORMED = [
  ["config hilang", undefined, "PRODUCTION_FLAG_CONFIG_INVALID"],
  ["config null", null, "PRODUCTION_FLAG_CONFIG_INVALID"],
  ["config string", "unitIds", "PRODUCTION_FLAG_CONFIG_INVALID"],
  ["config array", [U1], "PRODUCTION_FLAG_CONFIG_INVALID"],
  ["config objek kosong", {}, "PRODUCTION_FLAG_COHORT_MISSING"],
  ["unitIds null", { unitIds: null }, "PRODUCTION_FLAG_COHORT_MISSING"],
  ["unitIds array kosong", { unitIds: [] }, "PRODUCTION_FLAG_COHORT_MISSING"],
  ["unitIds string", { unitIds: U1 }, "PRODUCTION_FLAG_COHORT_INVALID"],
  ["unitIds objek", { unitIds: { 0: U1 } }, "PRODUCTION_FLAG_COHORT_INVALID"],
  ["unitIds angka", { unitIds: 1 }, "PRODUCTION_FLAG_COHORT_INVALID"],
  ["elemen bukan UUID", { unitIds: ["u1"] }, "PRODUCTION_FLAG_COHORT_INVALID"],
  ["elemen kosong", { unitIds: [""] }, "PRODUCTION_FLAG_COHORT_INVALID"],
  ["elemen null", { unitIds: [U1, null] }, "PRODUCTION_FLAG_COHORT_INVALID"],
  ["elemen angka", { unitIds: [U1, 7] }, "PRODUCTION_FLAG_COHORT_INVALID"],
  ["satu valid + satu invalid (tidak difilter diam-diam)", { unitIds: [U1, "salah"] }, "PRODUCTION_FLAG_COHORT_INVALID"],
  ["UUID terpotong", { unitIds: [U1.slice(0, -1)] }, "PRODUCTION_FLAG_COHORT_INVALID"],
  ["UUID ganda", { unitIds: [U1, U1] }, "PRODUCTION_FLAG_COHORT_DUPLICATE"],
  ["UUID ganda beda huruf besar/kecil", { unitIds: [U1, U1.toUpperCase()] }, "PRODUCTION_FLAG_COHORT_DUPLICATE"],
  ["userIds (tidak didukung) walau unitIds valid", { unitIds: [U1], userIds: ["x"] }, "PRODUCTION_FLAG_UNSUPPORTED_KEY"],
  ["mode GLOBAL eksplisit ditolak", { unitIds: [U1], mode: "GLOBAL" }, "PRODUCTION_FLAG_UNSUPPORTED_KEY"],
  ["global:true tanpa unitIds ditolak", { global: true }, "PRODUCTION_FLAG_UNSUPPORTED_KEY"],
];

test("writer & reader produksi: ON dengan config rusak/hilang/kosong/ganda/tipe salah/UUID invalid -> OFF + diagnostic aman (bukan GLOBAL)", () => {
  quiet(() => {
    for (const [label, config, code] of MALFORMED) {
      for (const [resolve, isEnabled, OFF, key] of [
        [resolveProductionWriterState, isProductionWriterEnabledFor, PRODUCTION_WRITER_MODE.OFF, V2_FLAGS.PRODUCTION_WRITER],
        [resolveProductionReaderState, isProductionReaderEnabledFor, PRODUCTION_READER_MODE.OFF, V2_FLAGS.PRODUCTION_READER],
      ]) {
        const state = resolve({ [key]: { key, enabled: true, config } });
        assert.equal(state.mode, OFF, `${label} (${key})`);
        assert.equal(state.diagnostic, code, `${label} (${key}) diagnostic`);
        assert.equal(state.unitIds.size, 0, label);
        for (const unitId of [U1, U2, "apa-saja", null, undefined]) assert.equal(isEnabled(state, unitId), false, `${label}: ${unitId}`);
        assert.equal(String(state.diagnostic).includes(U1), false, "diagnostic tanpa ID");
      }
    }
  });
});

test("writer produksi: flag hilang / tabel tidak tersedia -> OFF; flag mentah (unavailable) tidak menyalakan apa pun", () => {
  assert.equal(resolveProductionWriterState({}).mode, PRODUCTION_WRITER_MODE.OFF);
  assert.equal(resolveProductionReaderState({}).mode, PRODUCTION_READER_MODE.OFF);
  const unavailable = { [V2_FLAGS.PRODUCTION_WRITER]: { key: V2_FLAGS.PRODUCTION_WRITER, enabled: false, config: {}, unavailable: true } };
  assert.equal(resolveProductionWriterState(unavailable).mode, PRODUCTION_WRITER_MODE.OFF);
});

test("diagnostic hanya dicatat sekali per perubahan (tanpa banjir log) dan tidak memuat ID", () => {
  const lines = [];
  const original = console.warn;
  console.warn = (line) => lines.push(String(line));
  try {
    const bad = flags(true, { unitIds: [] });
    resolveProductionWriterState(bad); resolveProductionWriterState(bad); resolveProductionWriterState(bad);
    assert.equal(lines.filter((l) => l.includes("PRODUCTION_FLAG_COHORT_MISSING")).length, 1);
    assert.ok(lines.every((l) => !l.includes(U1)));
    resolveProductionWriterState(flags(true, { unitIds: [U1] }));
    resolveProductionWriterState(bad);
    assert.equal(lines.filter((l) => l.includes("PRODUCTION_FLAG_COHORT_MISSING")).length, 2, "muncul lagi setelah keadaan sehat");
  } finally { console.warn = original; }
});

test("reader produksi (visibilitas antrean): flag berdiri sendiri dari writer, pola OFF/COHORT fail-closed", () => {
  const off = resolveProductionReaderState(readerFlags(false, { unitIds: [U1] }));
  assert.equal(off.mode, PRODUCTION_READER_MODE.OFF);
  assert.equal(isProductionReaderEnabledFor(off, U1), false);

  const cohort = resolveProductionReaderState(readerFlags(true, { unitIds: [U1] }));
  assert.equal(cohort.mode, PRODUCTION_READER_MODE.COHORT);
  assert.equal(isProductionReaderEnabledFor(cohort, U1), true);
  assert.equal(isProductionReaderEnabledFor(cohort, U2), false, "unit di luar cohort reader -> disembunyikan");
  assert.equal(isProductionReaderEnabledFor(cohort, null), false, "fail-closed tanpa unitId");

  assert.equal(resolveProductionReaderState({}).mode, PRODUCTION_READER_MODE.OFF, "flag hilang -> OFF, bukan error");

  // Reader dan writer adalah flag TERPISAH: mengaktifkan satu tidak ikut mengaktifkan yang lain.
  const both = { ...flags(true, { unitIds: [U1] }), ...readerFlags(false) };
  assert.equal(resolveProductionReaderState(both).mode, PRODUCTION_READER_MODE.OFF);
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
