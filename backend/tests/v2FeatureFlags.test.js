import test from "node:test";
import assert from "node:assert/strict";
import { assertDeliveryReaderGate, isFlagEnabled, V2_FLAGS } from "../src/services/v2FeatureFlags.js";

function flags(values = {}) {
  return Object.fromEntries(Object.values(V2_FLAGS).map((key) => [key, { key, enabled: values[key] === true, config: {} }]));
}

test("reader Delivery V2 ditolak sebelum kedua writer aktif", () => {
  const value = flags({ [V2_FLAGS.DRIVER_SNAPSHOT_READER]: true, [V2_FLAGS.DELIVERY_ROUTE_WRITER]: true });
  assert.throws(() => assertDeliveryReaderGate(value), { code: "V2_READER_GATE_VIOLATION" });
});

test("reader Delivery V2 boleh aktif setelah route dan execution writer aktif", () => {
  const value = flags({
    [V2_FLAGS.DRIVER_SNAPSHOT_READER]: true,
    [V2_FLAGS.DELIVERY_ROUTE_WRITER]: true,
    [V2_FLAGS.DELIVERY_EXECUTION_WRITER]: true,
  });
  assert.equal(assertDeliveryReaderGate(value), true);
});

test("cohort user dan device fail-closed", () => {
  const value = flags();
  value[V2_FLAGS.DRIVER_SNAPSHOT_READER] = { enabled: true, config: { userIds: ["u-1"], deviceIds: ["d-1"] } };
  assert.equal(isFlagEnabled(value, V2_FLAGS.DRIVER_SNAPSHOT_READER, { userId: "u-1", deviceId: "d-1" }), true);
  assert.equal(isFlagEnabled(value, V2_FLAGS.DRIVER_SNAPSHOT_READER, { userId: "u-2", deviceId: "d-1" }), false);
  assert.equal(isFlagEnabled({}, V2_FLAGS.DRIVER_SNAPSHOT_READER, { userId: "u-1", deviceId: "d-1" }), false);
});
