import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { auditCustodyWriters, loadBackendSources, runCustodyWriterAudit } from "../scripts/production-delivery-v2/audit-custody-writers.js";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATION = "20260928090000_unit_custody_handoff_v2";
const sql = fs.readFileSync(path.join(backendRoot, "prisma", "migrations", MIGRATION, "migration.sql"), "utf8").replace(/\r\n/g, "\n");
const executable = sql.split("\n").filter((line) => !line.startsWith("--")).join("\n");

test("migration custody hanya aditif: tidak ada DROP/TRUNCATE/DELETE/UPDATE/RENAME dan tidak mengubah tabel existing", () => {
  const withoutFkActions = executable.replace(/ON (DELETE|UPDATE) (SET NULL|CASCADE|RESTRICT|NO ACTION)/g, "");
  assert.equal(/\b(DROP|TRUNCATE|DELETE|UPDATE|RENAME|INSERT)\b/i.test(withoutFkActions), false);
  const altered = [...executable.matchAll(/ALTER TABLE "([^"]+)"/g)].map((m) => m[1]);
  assert.ok(altered.length > 0);
  for (const table of altered) assert.equal(table, "unit_custody_handoffs_v2", `hanya tabel baru yang boleh di-ALTER (ditemukan ${table})`);
  assert.deepEqual([...executable.matchAll(/CREATE TABLE "([^"]+)"/g)].map((m) => m[1]), ["unit_custody_handoffs_v2"]);
});

test("migration custody: FK hanya ke units, jobs, storage_locations, production_runs_v2 dan tidak menyentuh Sales/Finance/Messenger", () => {
  const parents = [...executable.matchAll(/REFERENCES "([^"]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(parents, ["jobs", "production_runs_v2", "storage_locations", "units"]);
  for (const name of ["Customer", "Conversation", "Message", "Order", "Payment", "fin_"]) {
    assert.equal(executable.includes(`"${name}`), false, `tidak boleh mereferensikan ${name}`);
  }
});

test("migration custody menegakkan unique (job, unit) dan satu handoff aktif per unit+direction (partial index)", () => {
  assert.match(executable, /CREATE UNIQUE INDEX "unit_custody_handoffs_v2_delivery_job_id_unit_id_key" ON "unit_custody_handoffs_v2"\("delivery_job_id", "unit_id"\)/);
  assert.match(executable, /CREATE UNIQUE INDEX "unit_custody_handoffs_v2_active_unit_direction_key"\s+ON "unit_custody_handoffs_v2"\("unit_id", "direction"\)\s+WHERE "status" IN \('OFFERED', 'ACCEPTED'\)/);
  assert.match(executable, /'OFFERED', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'SUPERSEDED'/);
  assert.match(executable, /"location_id" UUID/);
  assert.equal(sql.includes("\r"), false, "migration harus LF (checksum stabil)");
});

test("migration custody menegakkan satu run produksi AKTIF per unit (backstop DB untuk lock aplikasi); kolom rollback (cancelled_by_id/at) additive", () => {
  assert.match(executable, /CREATE UNIQUE INDEX "production_runs_v2_active_unit_key"\s+ON "production_runs_v2"\("unit_id"\)\s+WHERE "status" NOT IN \('COMPLETED', 'CANCELLED'\)/);
  assert.match(executable, /"cancelled_by_id" TEXT/);
  assert.match(executable, /"cancelled_at" TIMESTAMP\(3\)/);
  // Index baru ini TIDAK boleh berbentuk ALTER TABLE pada production_runs_v2 (tabel lama) — hanya CREATE INDEX.
  assert.equal(executable.includes('ALTER TABLE "production_runs_v2"'), false, "tabel lama hanya diberi index tambahan, tidak diubah kolomnya");
});

test("writer audit custody pada source aktual: 0 pelanggaran, dua jalur armada ter-hook, penulis handoff hanya command owner", () => {
  const report = runCustodyWriterAudit(backendRoot);
  assert.equal(report.totals.violations, 0, JSON.stringify(report.findings.filter((f) => !f.ok)));
  assert.equal(report.totals.armadaHooks, 2);
  assert.equal(report.totals.custodyHooked, 2);
  assert.ok(report.findings.filter((f) => f.kind === "HANDOFF_WRITER").every((f) => f.file === "src/services/unitCustodyCommandService.js"));
  assert.ok(report.totals.pendingLaterSlice >= 1, "gap slice berikutnya harus terlihat, bukan disembunyikan");
});

test("writer audit gagal untuk penulis handoff tak terdaftar, jalur pickup tanpa custody, dan penulis unit baru tak terklasifikasi", () => {
  const sources = loadBackendSources(backendRoot);
  const bad = new Map(sources);
  bad.set("src/routes/liar.js", "await tx.unitCustodyHandoff.update({ where: { id }, data: { status: 'ACCEPTED' } });\n");
  bad.set("src/services/baru.js", "await tx.unit.updateMany({ where: {}, data: { status: \"RECEIVED\" } });\n");
  const result = auditCustodyWriters(bad);
  const violations = result.findings.filter((f) => !f.ok).map((f) => f.disposition).sort();
  assert.deepEqual(violations, ["UNOWNED_HANDOFF_WRITER", "UNOWNED_UNIT_PATH_WRITER"]);

  const unhooked = new Map(sources);
  unhooked.set("src/routes/armada.js", sources.get("src/routes/armada.js").replaceAll("offerUnitCustody(tx", "tanpaCustody(tx"));
  const missing = auditCustodyWriters(unhooked);
  assert.equal(missing.armadaHooks, 0);
  assert.equal(missing.findings.filter((f) => f.disposition === "PICKUP_RETURN_PATH_WITHOUT_CUSTODY").length, 2);
});
