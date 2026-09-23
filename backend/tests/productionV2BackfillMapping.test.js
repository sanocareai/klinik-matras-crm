import test from "node:test";
import assert from "node:assert/strict";
import { legacyProductionPhaseToV2 } from "../src/services/productionV2BackfillMapping.js";

test("fase routing legacy dipetakan ke lifecycle V2 yang sah", () => {
  assert.equal(legacyProductionPhaseToV2("INTAKE"), "INTAKE");
  assert.equal(legacyProductionPhaseToV2("MODULE"), "PROCESS");
  assert.equal(legacyProductionPhaseToV2("FINISH"), "QC");
});

test("fase kosong atau tidak dikenal tidak ditebak", () => {
  assert.equal(legacyProductionPhaseToV2(null), null);
  assert.equal(legacyProductionPhaseToV2("UNKNOWN"), null);
});

