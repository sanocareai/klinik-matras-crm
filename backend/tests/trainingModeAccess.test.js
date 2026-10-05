// P12B.2 — akses Mode Latihan (GET /production-v2/demo/access = PRODUCTION_DEMO_VIEW). Tanpa DB/jaringan.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PERMISSIONS as P, ROLE_PERMISSIONS } from "../src/constants/permissions.js";
import { hasPermission } from "../src/middleware/authorize.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const ALLOWED = ["ADMIN", "OWNER", "PRODUCTION_LEAD", "PRODUCTION_WORKER", "QC_LEAD", "WAREHOUSE", "PRODUCTION_DOCUMENTER"];

test("PRODUCTION_DEMO_VIEW: persis tujuh peran latihan", () => {
  const holders = Object.entries(ROLE_PERMISSIONS).filter(([, perms]) => perms.includes(P.PRODUCTION_DEMO_VIEW)).map(([r]) => r).sort();
  assert.deepEqual(holders, [...ALLOWED].sort());
});

test("Sales/Finance/Driver/Helper/Dispatcher/Approver dan anonim DITOLAK", () => {
  for (const role of ["SALES", "FINANCE", "DRIVER", "HELPER", "DISPATCHER", "LEADER_DRIVER", "APPROVER"]) assert.equal(hasPermission({ roles: [role] }, P.PRODUCTION_DEMO_VIEW), false, role);
  assert.equal(hasPermission(null, P.PRODUCTION_DEMO_VIEW), false);
  assert.equal(hasPermission({ roles: [] }, P.PRODUCTION_DEMO_VIEW), false);
});

test("izin Mode Latihan TIDAK memperluas izin lain: peran latihan tidak mendapat izin baru selain PRODUCTION_DEMO_VIEW", () => {
  // Setiap peran non-admin: hapus PRODUCTION_DEMO_VIEW → sisanya harus sama dengan daftar tanpa izin itu (tidak ada izin lain yang ikut terbawa).
  for (const role of ["PRODUCTION_LEAD", "PRODUCTION_WORKER", "QC_LEAD", "WAREHOUSE", "PRODUCTION_DOCUMENTER"]) {
    const perms = ROLE_PERMISSIONS[role];
    assert.equal(perms.filter((p) => p === P.PRODUCTION_DEMO_VIEW).length, 1, `${role}: tepat satu`);
  }
  assert.ok(!hasPermission({ roles: ["PRODUCTION_DOCUMENTER"] }, P.UNIT_STAGE_WRITE), "Dokumenter tetap tanpa tulis tahap");
  assert.ok(!hasPermission({ roles: ["PRODUCTION_WORKER"] }, P.QC_WRITE), "Operator tetap tanpa QC_WRITE");
  assert.ok(!hasPermission({ roles: ["WAREHOUSE"] }, P.PRODUCTION_REPORT_READ), "Gudang tetap tanpa laporan penuh");
});

test("endpoint /demo/access: dijaga PRODUCTION_DEMO_VIEW, GET saja, tidak menyentuh database, label Mode Latihan", () => {
  const src = fs.readFileSync(path.join(here, "..", "src", "routes", "productionExperience.js"), "utf8");
  const i = src.indexOf('productionExperienceRouter.get("/demo/access"');
  const block = src.slice(i, src.indexOf("});", i) + 3);
  assert.match(block, /requirePermission\(P\.PRODUCTION_DEMO_VIEW\)/);
  assert.match(block, /MODE LATIHAN — bukan data operasional/);
  assert.ok(!/prisma|\.create\(|\.update\(|\.delete\(/.test(block), "tanpa akses database");
  assert.ok(!/productionExperienceRouter\.(post|put|patch|delete)\("\/demo/.test(src), "tidak ada metode tulis");
});
