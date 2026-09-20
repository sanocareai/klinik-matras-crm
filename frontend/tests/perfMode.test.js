import test from "node:test";
import assert from "node:assert/strict";
import { decideMode, createFpsGovernor } from "../src/lib/perfMode.js";

test("pilihan eksplisit user menang atas semua sinyal", () => {
  assert.equal(decideMode({ pref: "lite", deviceMemory: 12, hardwareConcurrency: 16 }), "lite");
  assert.equal(decideMode({ pref: "full", deviceMemory: 2, saveData: true, isAndroid: true }), "full");
});
test("auto: RAM kecil / core sedikit / hemat data / baterai lemah / sudah terdegradasi → lite", () => {
  assert.equal(decideMode({ deviceMemory: 2 }), "lite");
  assert.equal(decideMode({ deviceMemory: 8, hardwareConcurrency: 4 }), "lite");
  assert.equal(decideMode({ deviceMemory: 8, hardwareConcurrency: 8, saveData: true }), "lite");
  assert.equal(decideMode({ deviceMemory: 8, hardwareConcurrency: 8, batteryLow: true }), "lite");
  assert.equal(decideMode({ deviceMemory: 8, hardwareConcurrency: 8, degraded: true }), "lite");
});
test("auto konservatif di Android/PWA: Penuh hanya untuk perangkat jelas kuat", () => {
  assert.equal(decideMode({ isAndroid: true, deviceMemory: 6, hardwareConcurrency: 8 }), "lite");
  assert.equal(decideMode({ isStandalone: true }), "lite", "sinyal tidak diketahui → lite");
  assert.equal(decideMode({ isAndroid: true, deviceMemory: 8, hardwareConcurrency: 8 }), "full");
});
test("auto desktop kencang / sinyal tidak tersedia → full", () => {
  assert.equal(decideMode({ deviceMemory: 8, hardwareConcurrency: 12 }), "full");
  assert.equal(decideMode({}), "full");
});
test("governor FPS: scroll patah-patah → degrade sekali; lancar → tidak", () => {
  let called = 0;
  const bad = createFpsGovernor({ minSamples: 20, thresholdMs: 28, onDegrade: () => called++ });
  for (let i = 0; i < 40; i++) bad.push(i % 4 ? 45 : 16);
  assert.equal(called, 1); assert.equal(bad.degraded, true);
  let ok = 0;
  const good = createFpsGovernor({ minSamples: 20, onDegrade: () => ok++ });
  for (let i = 0; i < 200; i++) good.push(16.7);
  assert.equal(ok, 0); assert.equal(good.degraded, false);
});
test("governor mengabaikan jeda besar (tab background) & nilai tidak valid", () => {
  let called = 0;
  const g = createFpsGovernor({ minSamples: 10, onDegrade: () => called++ });
  for (let i = 0; i < 50; i++) { g.push(5000); g.push(-1); g.push(NaN); }
  assert.equal(called, 0);
});
