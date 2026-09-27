import test from "node:test";
import assert from "node:assert/strict";
import {
  DELIVERY_WRITER_MODE, V2_FLAGS, deliveryWriterDecision, isDeliveryWriterEnabledFor, resolveDeliveryWriterState,
} from "../src/services/v2FeatureFlags.js";

const flags = (route, execution) => ({
  [V2_FLAGS.DELIVERY_ROUTE_WRITER]: { key: V2_FLAGS.DELIVERY_ROUTE_WRITER, enabled: route.enabled, config: route.config || {} },
  [V2_FLAGS.DELIVERY_EXECUTION_WRITER]: { key: V2_FLAGS.DELIVERY_EXECUTION_WRITER, enabled: execution.enabled, config: execution.config || {} },
});
const cohort = (...routeIds) => ({ enabled: true, config: { routeIds } });
// Klien palsu: job -> route authoritative.
const client = (jobRoutes) => ({ job: { findMany: async ({ where }) => where.id.in.map((id) => ({ routeId: jobRoutes[id] ?? null })) } });

test("1. kedua flag OFF -> OFF untuk semua context", () => {
  const state = resolveDeliveryWriterState(flags({ enabled: false }, { enabled: false }));
  assert.equal(state.mode, DELIVERY_WRITER_MODE.OFF);
  assert.equal(isDeliveryWriterEnabledFor(state, ["r1"]), false);
  assert.equal(isDeliveryWriterEnabledFor(state, []), false);
});

test("2. kedua ON tanpa cohort -> GLOBAL legacy (aktif walau tanpa route context)", () => {
  const state = resolveDeliveryWriterState(flags({ enabled: true }, { enabled: true }));
  assert.equal(state.mode, DELIVERY_WRITER_MODE.GLOBAL);
  assert.equal(isDeliveryWriterEnabledFor(state, []), true);
  assert.equal(isDeliveryWriterEnabledFor(state, ["apa-saja"]), true);
});

test("3. route cohort cocok -> aktif", () => {
  const state = resolveDeliveryWriterState(flags(cohort("r1"), cohort("r1")));
  assert.equal(state.mode, DELIVERY_WRITER_MODE.COHORT);
  assert.equal(isDeliveryWriterEnabledFor(state, ["r1"]), true);
});

test("4. route cohort tidak cocok -> V1-only", () => {
  const state = resolveDeliveryWriterState(flags(cohort("r1"), cohort("r1")));
  assert.equal(isDeliveryWriterEnabledFor(state, ["r2"]), false);
});

test("5. context route hilang (termasuk command system/background) -> V1-only", () => {
  const state = resolveDeliveryWriterState(flags(cohort("r1"), cohort("r1")));
  assert.equal(isDeliveryWriterEnabledFor(state, []), false);
  assert.equal(isDeliveryWriterEnabledFor(state, [null, undefined]), false);
});

test("route di dalam DAN di luar cohort sekaligus -> 409 WRITER_COHORT_BOUNDARY", () => {
  const state = resolveDeliveryWriterState(flags(cohort("r1"), cohort("r1")));
  assert.throws(() => isDeliveryWriterEnabledFor(state, ["r1", "r2"]), (error) => error.statusCode === 409 && error.code === "WRITER_COHORT_BOUNDARY");
});

test("6. command berbasis job me-resolve route authoritative dari database, bukan dari request", async () => {
  const f = flags(cohort("r1"), cohort("r1"));
  assert.equal((await deliveryWriterDecision(client({ j1: "r1" }), f, { jobId: "j1" })).enabled, true);
  assert.equal((await deliveryWriterDecision(client({ j2: "r2" }), f, { jobId: "j2" })).enabled, false);
  assert.equal((await deliveryWriterDecision(client({ j3: null }), f, { jobId: "j3" })).enabled, false, "job tanpa route -> V1-only");
});

test("8. hanya satu writer ON -> keduanya OFF (pair wajib)", () => {
  for (const pair of [[{ enabled: true }, { enabled: false }], [{ enabled: false }, { enabled: true }], [cohort("r1"), { enabled: false }]]) {
    const state = resolveDeliveryWriterState(flags(...pair));
    assert.equal(state.mode, DELIVERY_WRITER_MODE.OFF);
    assert.equal(state.diagnostic, "WRITER_PAIR_INCOMPLETE");
    assert.equal(isDeliveryWriterEnabledFor(state, ["r1"]), false);
  }
});

test("9. daftar route kedua flag berbeda -> keduanya OFF", () => {
  for (const pair of [[cohort("r1"), cohort("r2")], [cohort("r1"), { enabled: true }], [cohort("r1", "r2"), cohort("r1")]]) {
    const state = resolveDeliveryWriterState(flags(...pair));
    assert.equal(state.mode, DELIVERY_WRITER_MODE.OFF);
    assert.equal(state.diagnostic, "WRITER_COHORT_MISMATCH");
  }
  // urutan dan duplikat tidak dianggap beda
  assert.equal(resolveDeliveryWriterState(flags(cohort("r2", "r1", "r1"), cohort("r1", "r2"))).mode, DELIVERY_WRITER_MODE.COHORT);
});

test("userIds pada writer tanpa routeIds -> OFF (tidak menjadi user cohort lifecycle)", () => {
  const state = resolveDeliveryWriterState(flags({ enabled: true, config: { userIds: ["u1"] } }, { enabled: true }));
  assert.equal(state.mode, DELIVERY_WRITER_MODE.OFF);
  assert.equal(state.diagnostic, "WRITER_USER_COHORT_UNSUPPORTED");
});

test("route cohort tidak mensyaratkan userIds: dispatcher dan driver yang berbeda sama-sama aktif", async () => {
  const f = flags({ enabled: true, config: { routeIds: ["r1"], userIds: ["dispatcher"] } }, { enabled: true, config: { routeIds: ["r1"] } });
  assert.equal((await deliveryWriterDecision(client({}), f, { routeId: "r1" })).enabled, true);
  assert.equal((await deliveryWriterDecision(client({ j1: "r1" }), f, { jobId: "j1" })).enabled, true);
});
