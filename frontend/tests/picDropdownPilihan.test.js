// Dropdown PIC V1 (Unit 360 Tugaskan) dan Planner V2 memakai daftar pilihan TANPA ADMIN/OWNER; halaman Operator tetap daftar penuh.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(here, "..", "src", ...p), "utf8").replace(/\r\n/g, "\n");

test("api: getProductionOperatorChoices memanggil ?pilihan=1; getProductionOperators tetap daftar penuh", () => {
  const api = read("api.js");
  assert.match(api, /getProductionOperators: \(\) => request\("\/production\/operators"\),/);
  assert.match(api, /getProductionOperatorChoices: \(\) => request\("\/production\/operators\?pilihan=1"\)/);
});

test("dropdown pilihan memakai Choices; halaman Operator memakai daftar penuh", () => {
  assert.match(read("features", "production", "UnitV1Stage.jsx"), /api\.getWorkCenters\(\), api\.getProductionOperatorChoices\(\)/);
  assert.match(read("pages", "bengkel", "ProductionPlannerV2.jsx"), /api\.getProductionOperatorChoices\(\)\.catch/);
  assert.match(read("pages", "bengkel", "ProductionOperators.jsx"), /api\.getProductionOperators\(\)\.then/);
});
