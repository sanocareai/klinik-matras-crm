// Tes P8.1 (UI & Navigation Consolidation) — mapping route Production lama
// ke penggantinya. Lihat src/lib/legacyProductionRoutes.js.
import test from "node:test";
import assert from "node:assert/strict";

import { LEGACY_PRODUCTION_ROUTES, isLegacyProductionRoute } from "../src/lib/legacyProductionRoutes.js";

const EXPECTED_OLD_PATHS = [
  "/bengkel",
  "/bengkel/planning",
  "/bengkel/workshop",
  "/bengkel/work-orders",
  "/bengkel/orders",
  "/bengkel/qc",
  "/bengkel/qc-v2",
];

test("semua route lama yang dikonsolidasi tetap terdaftar (tidak dihapus)", () => {
  for (const p of EXPECTED_OLD_PATHS) {
    assert.ok(LEGACY_PRODUCTION_ROUTES.some((r) => r.to === p), `route lama hilang dari daftar: ${p}`);
  }
});

test("setiap entri legacy punya label dan tujuan pengganti (replacedBy)", () => {
  for (const r of LEGACY_PRODUCTION_ROUTES) {
    assert.ok(r.label && r.label.length > 0, `${r.to} tidak punya label`);
    assert.ok(r.replacedBy && r.replacedBy.startsWith("/"), `${r.to} tidak punya replacedBy yang valid`);
  }
});

test("tidak ada path lama yang terdaftar dobel", () => {
  const paths = LEGACY_PRODUCTION_ROUTES.map((r) => r.to);
  assert.equal(new Set(paths).size, paths.length);
});

test("isLegacyProductionRoute: true untuk route lama, false untuk route baru", () => {
  assert.equal(isLegacyProductionRoute("/bengkel/work-orders"), true);
  assert.equal(isLegacyProductionRoute("/bengkel/order-produksi"), false);
  assert.equal(isLegacyProductionRoute("/bengkel/production-v2"), false);
});
