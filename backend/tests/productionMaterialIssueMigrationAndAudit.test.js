import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { auditMaterialIssueWriters, loadBackendSources, runMaterialIssueWriterAudit } from "../scripts/production-delivery-v2/audit-material-issue-writers.js";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATION = "20260930080000_production_material_issue_v2";
const sql = fs.readFileSync(path.join(backendRoot, "prisma", "migrations", MIGRATION, "migration.sql"), "utf8").replace(/\r\n/g, "\n");
const executable = sql.split("\n").filter((line) => !line.startsWith("--")).join("\n");

test("migration P4 aditif: hanya ADD COLUMN nullable/default, tanpa DROP/UPDATE/DELETE/TRUNCATE/RENAME/SET NOT NULL pada data lama", () => {
  const withoutFkActions = executable.replace(/ON (DELETE|UPDATE) (SET NULL|CASCADE|RESTRICT|NO ACTION)/g, "");
  assert.equal(/\b(DROP|TRUNCATE|DELETE|UPDATE|RENAME|INSERT)\b/i.test(withoutFkActions), false);
  assert.equal(/ALTER COLUMN|SET NOT NULL/i.test(executable), false);
  assert.equal(/CREATE TABLE/i.test(executable), false, "tidak ada tabel baru di P4");
  const altered = [...executable.matchAll(/ALTER TABLE "([^"]+)"/g)].map((m) => m[1]);
  for (const table of altered) assert.ok(["material_issues", "material_issue_lines", "material_reservations_v2"].includes(table), `tabel tak terduga: ${table}`);
  // Satu-satunya kolom NOT NULL yang ditambah punya DEFAULT (aman untuk baris lama).
  for (const m of executable.matchAll(/ADD COLUMN\s+"(\w+)"\s+([^,;]+)/g)) {
    if (/NOT NULL/.test(m[2])) assert.match(m[2], /DEFAULT/, `${m[1]} NOT NULL harus punya DEFAULT`);
  }
});

test("migration P4: FK hanya ke production_run_plans_v2 dan material_reservations_v2; partial unique satu issue aktif per plan; LF", () => {
  const parents = [...new Set([...executable.matchAll(/REFERENCES "([^"]+)"/g)].map((m) => m[1]))].sort();
  assert.deepEqual(parents, ["material_reservations_v2", "production_run_plans_v2"]);
  assert.match(executable, /CREATE UNIQUE INDEX "material_issues_active_plan_key" ON "material_issues"\("production_plan_id"\) WHERE "production_plan_id" IS NOT NULL AND "status" NOT IN \('ISSUED', 'CANCELLED'\)/);
  assert.match(executable, /CREATE UNIQUE INDEX "material_issue_lines_reservation_id_key" ON "material_issue_lines"\("reservation_id"\)/);
  assert.equal(sql.includes("\r"), false, "migration harus LF (checksum stabil)");
});

test("writer audit P4 pada source aktual: 0 pelanggaran; ledger hanya lewat inventoryLedger; HPP lewat jalur kanonis, tanpa jurnal sendiri", () => {
  const report = runMaterialIssueWriterAudit(backendRoot);
  assert.equal(report.totals.violations, 0, JSON.stringify(report.findings.filter((f) => !f.ok)));
  assert.equal(report.totals.usesLedger, true);
  assert.equal(report.totals.usesHpp, true);
  assert.equal(report.totals.ownJournal, false);
  assert.ok(report.findings.filter((f) => f.kind === "STOCK_MOVEMENT_WRITER").every((f) => f.file === "src/services/inventoryLedger.js"));
});

test("writer audit P4 gagal untuk penulis tak terdaftar (issue, reservasi, stock movement langsung) dan jurnal sendiri di command owner", () => {
  const sources = loadBackendSources(backendRoot);
  const bad = new Map(sources);
  bad.set("src/routes/liar.js", "await tx.materialIssue.update({ where: { id }, data: { status: 'ISSUED' } });\nawait tx.materialReservation.update({});\nawait tx.stockMovement.create({ data: {} });\n");
  const violations = auditMaterialIssueWriters(bad).findings.filter((f) => !f.ok).map((f) => f.kind).sort();
  assert.deepEqual(violations, ["MATERIAL_ISSUE_WRITER", "RESERVATION_WRITER", "STOCK_MOVEMENT_WRITER"]);

  const p4 = "src/services/productionMaterialIssueCommandService.js";
  const journal = new Map(sources); journal.set(p4, `${sources.get(p4)}\nawait tx.journalEntry.create({ data: {} });\n`);
  assert.ok(auditMaterialIssueWriters(journal).findings.some((f) => f.disposition === "OWN_JOURNAL_WRITE_FORBIDDEN"));
  const noLedger = new Map(sources); noLedger.set(p4, sources.get(p4).replaceAll("postStockMovement(tx,", "tulisLedger(tx,"));
  assert.ok(auditMaterialIssueWriters(noLedger).findings.some((f) => f.disposition === "MISSING_postStockMovement"));
});
