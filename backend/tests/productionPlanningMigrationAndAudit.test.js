import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { auditPlanningWriters, loadBackendSources, runPlanningWriterAudit } from "../scripts/production-delivery-v2/audit-planning-writers.js";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATION = "20260929080000_production_planning_reservation_v2";
const sql = fs.readFileSync(path.join(backendRoot, "prisma", "migrations", MIGRATION, "migration.sql"), "utf8").replace(/\r\n/g, "\n");
const executable = sql.split("\n").filter((line) => !line.startsWith("--")).join("\n");

test("migration planning hanya aditif: tidak ada DROP/TRUNCATE/DELETE/UPDATE/RENAME dan tidak mengubah tabel existing", () => {
  const withoutFkActions = executable.replace(/ON (DELETE|UPDATE) (SET NULL|CASCADE|RESTRICT|NO ACTION)/g, "");
  assert.equal(/\b(DROP|TRUNCATE|DELETE|UPDATE|RENAME|INSERT)\b/i.test(withoutFkActions), false);
  const NEW_TABLES = ["production_run_plans_v2", "planned_bom_lines_v2", "material_reservations_v2"];
  const altered = [...executable.matchAll(/ALTER TABLE "([^"]+)"/g)].map((m) => m[1]);
  assert.ok(altered.length > 0);
  for (const table of altered) assert.ok(NEW_TABLES.includes(table), `hanya tabel baru yang boleh di-ALTER (ditemukan ${table})`);
  assert.deepEqual(
    [...executable.matchAll(/CREATE TABLE "([^"]+)"/g)].map((m) => m[1]).sort(),
    ["material_reservations_v2", "planned_bom_lines_v2", "production_run_plans_v2"],
  );
});

test("migration planning: FK hanya ke production_runs_v2, work_centers, production_operators, materials, planned_bom_lines_v2, production_run_plans_v2", () => {
  const parents = [...new Set([...executable.matchAll(/REFERENCES "([^"]+)"/g)].map((m) => m[1]))].sort();
  assert.deepEqual(parents, ["materials", "planned_bom_lines_v2", "production_operators", "production_run_plans_v2", "production_runs_v2", "work_centers"]);
  for (const name of ["Customer", "Conversation", "Message", "Order", "Payment", "fin_", "unit_custody_handoffs_v2", "stock_movements", "material_issue"]) {
    assert.equal(executable.includes(`"${name}`), false, `tidak boleh mereferensikan ${name}`);
  }
});

test("migration planning menegakkan satu Plan per Run (1:1), satu Planned BOM line AKTIF per (plan,material), dan satu reservasi AKTIF per BOM line (partial index)", () => {
  assert.match(executable, /CREATE UNIQUE INDEX "production_run_plans_v2_run_id_key" ON "production_run_plans_v2"\("run_id"\)/);
  assert.match(executable, /CREATE UNIQUE INDEX "planned_bom_lines_v2_active_material_key" ON "planned_bom_lines_v2"\("plan_id", "material_id"\) WHERE "status" = 'ACTIVE'/);
  assert.match(executable, /CREATE UNIQUE INDEX "material_reservations_v2_active_bom_line_key" ON "material_reservations_v2"\("bom_line_id"\) WHERE "status" = 'ACTIVE'/);
  assert.equal(sql.includes("\r"), false, "migration harus LF (checksum stabil)");
});

test("migration planning: qty snapshot Decimal(12,4), unit/status enum ada, tidak menulis stock_movements", () => {
  assert.match(executable, /"qty" DECIMAL\(12,4\) NOT NULL/);
  assert.match(executable, /CREATE TYPE "ProductionPlanStatus" AS ENUM \('DRAFT', 'PLANNED', 'MATERIAL_RESERVED', 'CANCELLED'\)/);
  assert.match(executable, /CREATE TYPE "PlannedBOMLineStatus" AS ENUM \('ACTIVE', 'SUPERSEDED', 'CANCELLED'\)/);
  assert.match(executable, /CREATE TYPE "MaterialReservationStatus" AS ENUM \('ACTIVE', 'RELEASED', 'CONSUMED', 'CANCELLED'\)/);
});

test("writer audit planning pada source aktual: 0 pelanggaran, penulis hanya command owner", () => {
  const report = runPlanningWriterAudit(backendRoot);
  assert.equal(report.totals.violations, 0, JSON.stringify(report.findings.filter((f) => !f.ok)));
  assert.ok(report.totals.planWriters >= 1 && report.totals.bomLineWriters >= 1 && report.totals.reservationWriters >= 1);
});

test("writer audit planning gagal untuk penulis di luar command owner", () => {
  const sources = loadBackendSources(backendRoot);
  const bad = new Map(sources);
  bad.set("src/routes/liar.js", "await tx.productionRunPlan.update({ where: { id }, data: { status: 'CANCELLED' } });\n");
  bad.set("src/services/lain.js", "await tx.materialReservation.create({ data: {} });\n");
  const result = auditPlanningWriters(bad);
  const violations = result.findings.filter((f) => !f.ok).map((f) => f.disposition);
  assert.deepEqual(violations, ["UNOWNED_PLANNING_WRITER", "UNOWNED_PLANNING_WRITER"]);
});
