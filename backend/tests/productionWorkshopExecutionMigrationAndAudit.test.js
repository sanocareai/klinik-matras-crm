import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { auditWorkshopExecutionWriters, loadBackendSources, runWorkshopExecutionWriterAudit } from "../scripts/production-delivery-v2/audit-workshop-execution-writers.js";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATION = "20261001080000_production_workshop_execution_v2";
const sql = fs.readFileSync(path.join(backendRoot, "prisma", "migrations", MIGRATION, "migration.sql"), "utf8").replace(/\r\n/g, "\n");
const executable = sql.split("\n").filter((line) => !line.startsWith("--")).join("\n");
const P5 = "src/services/productionWorkshopExecutionCommandService.js";

test("migration P5 aditif: 1 enum, 1 kolom nullable di production_runs_v2, 1 partial unique satu tahap aktif per run; tanpa DROP/UPDATE/DELETE; LF", () => {
  assert.equal(/\b(DROP|TRUNCATE|DELETE|UPDATE|RENAME|INSERT)\b/i.test(executable), false);
  assert.equal(/CREATE TABLE|ALTER COLUMN|SET NOT NULL/i.test(executable), false);
  assert.deepEqual([...executable.matchAll(/CREATE TYPE "([^"]+)"/g)].map((m) => m[1]), ["ProductionRunOrigin"]);
  assert.match(executable, /ALTER TABLE "production_runs_v2" ADD COLUMN\s+"origin" "ProductionRunOrigin";/);
  assert.equal([...executable.matchAll(/ALTER TABLE/g)].length, 1);
  assert.match(executable, /CREATE UNIQUE INDEX "production_operation_runs_v2_active_run_key" ON "production_operation_runs_v2"\("run_id"\) WHERE "status" IN \('ACTIVE', 'PAUSED'\)/);
  assert.equal(sql.includes("\r"), false, "migration harus LF (checksum stabil)");
});

test("writer audit P5 pada source aktual: 0 pelanggaran; ledger tahap hanya engine; P5 memakai engine *InTx; engine memagari 7 jalur V1", () => {
  const report = runWorkshopExecutionWriterAudit(backendRoot);
  assert.equal(report.totals.violations, 0, JSON.stringify(report.findings.filter((f) => !f.ok)));
  assert.equal(report.totals.usesEngine, true);
  assert.ok(report.totals.engineFences >= 7);
  assert.ok(report.findings.filter((f) => f.kind === "STAGE_LOG_WRITER").every((f) => f.file === "src/services/unitStageEngine.js"));
});

test("writer audit P5 gagal: penulis operation run/stage log di luar owner, P5 menulis stok/reservasi/HPP, engine tanpa fence", () => {
  const sources = loadBackendSources(backendRoot);
  const bad = new Map(sources);
  bad.set("src/routes/liar.js", "await tx.productionOperationRun.update({});\nawait tx.unitStageLog.create({ data: {} });\nawait tx.productionRun.update({});\n");
  assert.deepEqual(auditWorkshopExecutionWriters(bad).findings.filter((f) => !f.ok).map((f) => f.kind).sort(), ["OPERATION_RUN_WRITER", "RUN_WRITER", "STAGE_LOG_WRITER"]);

  const stock = new Map(sources); stock.set(P5, `${sources.get(P5)}\nawait tx.stockMovement.create({ data: {} });\nawait tx.materialReservation.update({});\nawait postMaterialIssueCost(tx, {});\n`);
  const forbidden = auditWorkshopExecutionWriters(stock).findings.filter((f) => f.kind === "P5_FORBIDDEN_WRITE").map((f) => f.disposition).sort();
  assert.deepEqual(forbidden, ["FORBIDDEN_materialReservation", "FORBIDDEN_postMaterialIssueCost", "FORBIDDEN_stockMovement"]);

  const noFence = new Map(sources); noFence.set("src/services/unitStageEngine.js", sources.get("src/services/unitStageEngine.js").replaceAll("await assertNotV2ExecutionOwned(tx, unitId);", ""));
  assert.ok(auditWorkshopExecutionWriters(noFence).findings.some((f) => f.kind === "ENGINE_FENCE"));
});
