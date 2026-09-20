import test from "node:test";
import assert from "node:assert/strict";
import { detectLite } from "../src/lib/perfMode.js";

test("HP RAM kecil / core sedikit / hemat data → lite", () => {
  assert.equal(detectLite({ deviceMemory: 2 }), true);
  assert.equal(detectLite({ deviceMemory: 8, hardwareConcurrency: 4 }), true);
  assert.equal(detectLite({ deviceMemory: 8, hardwareConcurrency: 8, saveData: true }), true);
});
test("HP kencang → full; sinyal tidak tersedia → full", () => {
  assert.equal(detectLite({ deviceMemory: 8, hardwareConcurrency: 8 }), false);
  assert.equal(detectLite({}), false);
});
test("override manual menang", () => {
  assert.equal(detectLite({ deviceMemory: 2, override: "full" }), false);
  assert.equal(detectLite({ deviceMemory: 8, override: "lite" }), true);
});
