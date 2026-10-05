import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertPhasesReadyForHandoffDecision, assertRunPhasesTerminal, findPhaseInvariantViolation, findRunCompletionViolation,
  isStrictLifecycleRun, projectPhases, transitionPhases,
} from "../src/services/productionPhaseLifecycle.js";
import { auditPhaseLifecycleWriters, loadBackendSources, runPhaseLifecycleWriterAudit } from "../scripts/production-delivery-v2/audit-phase-lifecycle-writers.js";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const phases = (map) => Object.entries(map).map(([phase, status]) => ({ phase, status }));
const FRESH = { origin: "CUSTODY_PICKUP", migrationSource: null };
const LEGACY = { origin: null, migrationSource: "legacy-v1" };
const conflict = (fn, code) => assert.rejects(fn, (error) => error.statusCode === 409 && error.code === code, `harus 409 ${code}`);

// tx palsu: menyimpan fase run dan mencatat urutan tulis.
function fakeTx(run, phaseMap) {
  const rows = phases(phaseMap);
  const writes = [];
  return {
    writes, rows,
    productionRun: { findUnique: async () => ({ id: "r1", ...run, phases: rows.map((row) => ({ ...row })) }) },
    productionPhaseRun: {
      update: async ({ where, data }) => {
        writes.push([where.runId_phase.phase, data.status]);
        Object.assign(rows.find((row) => row.phase === where.runId_phase.phase), data);
      },
    },
  };
}

test("run baru vs legacy/backfill: hanya run dengan origin (tanpa migrationSource) diperiksa", () => {
  assert.equal(isStrictLifecycleRun({ origin: "CUSTODY_PICKUP" }), true);
  assert.equal(isStrictLifecycleRun({ origin: "WORKSHOP_BORN", migrationSource: null }), true);
  assert.equal(isStrictLifecycleRun({ origin: null, migrationSource: "x" }), false);
  assert.equal(isStrictLifecycleRun({ origin: "CUSTODY_PICKUP", migrationSource: "x" }), false);
  assert.equal(isStrictLifecycleRun(null), false);
});

test("invariant 1: paling banyak satu fase berjalan (ACTIVE/BLOCKED); NOT_STARTED dan terminal tidak dihitung", () => {
  assert.equal(findPhaseInvariantViolation(phases({ INTAKE: "ACTIVE", DIAGNOSIS: "NOT_STARTED", PROCESS: "NOT_STARTED" })), null);
  assert.equal(findPhaseInvariantViolation(phases({ INTAKE: "COMPLETED", PROCESS: "ACTIVE", HANDOFF: "NOT_STARTED" })), null);
  assert.deepEqual(findPhaseInvariantViolation(phases({ INTAKE: "ACTIVE", PROCESS: "ACTIVE" })), { code: "PHASE_MULTIPLE_IN_PROGRESS", phases: ["INTAKE", "PROCESS"] });
  assert.equal(findPhaseInvariantViolation(phases({ PROCESS: "ACTIVE", HANDOFF: "BLOCKED" })).code, "PHASE_MULTIPLE_IN_PROGRESS");
});

test("invariant 2: run boleh COMPLETED hanya bila semua fase terminal dan HANDOFF COMPLETED", () => {
  const done = { INTAKE: "COMPLETED", DIAGNOSIS: "NOT_APPLICABLE", PROCESS: "COMPLETED", QC: "COMPLETED", HANDOFF: "COMPLETED" };
  assert.equal(findRunCompletionViolation(phases(done)), null);
  for (const [phase, status] of [["INTAKE", "ACTIVE"], ["DIAGNOSIS", "NOT_STARTED"], ["PROCESS", "BLOCKED"], ["QC", "MIGRATION_REVIEW"]]) {
    assert.deepEqual(findRunCompletionViolation(phases({ ...done, [phase]: status })), { code: "RUN_PHASES_NOT_TERMINAL", phases: [phase] }, `${phase}:${status}`);
  }
  assert.equal(findRunCompletionViolation(phases({ ...done, HANDOFF: "NOT_APPLICABLE" })).code, "RUN_HANDOFF_NOT_COMPLETED");
  assert.equal(findRunCompletionViolation(phases({ ...done, HANDOFF: "NOT_APPLICABLE" }), { requireHandoffCompleted: false }), null, "penutupan override V1 eksplisit");
});

test("projectPhases murni dan menolak fase yang tidak ada", () => {
  const source = phases({ INTAKE: "ACTIVE", PROCESS: "NOT_STARTED" });
  const projected = projectPhases(source, [{ phase: "PROCESS", data: { status: "ACTIVE" } }]);
  assert.equal(projected.find((p) => p.phase === "PROCESS").status, "ACTIVE");
  assert.equal(source.find((p) => p.phase === "PROCESS").status, "NOT_STARTED", "input tidak dimutasi");
  assert.throws(() => projectPhases(source, [{ phase: "QC", data: { status: "ACTIVE" } }]), (error) => error.code === "PHASE_MISSING" && error.statusCode === 409);
});

test("transitionPhases: penutupan ditulis SEBELUM pembukaan, atomik dalam satu panggilan", async () => {
  const tx = fakeTx(FRESH, { INTAKE: "ACTIVE", DIAGNOSIS: "NOT_STARTED", PROCESS: "NOT_STARTED", QC: "NOT_STARTED", HANDOFF: "NOT_STARTED" });
  await transitionPhases(tx, "r1", [
    { phase: "PROCESS", data: { status: "ACTIVE" } },
    { phase: "INTAKE", data: { status: "COMPLETED" } },
    { phase: "DIAGNOSIS", data: { status: "NOT_APPLICABLE" } },
  ]);
  assert.deepEqual(tx.writes, [["INTAKE", "COMPLETED"], ["DIAGNOSIS", "NOT_APPLICABLE"], ["PROCESS", "ACTIVE"]]);
});

test("transitionPhases: membuka fase baru sambil fase lama masih berjalan -> 409 dan TIDAK ada tulisan sama sekali", async () => {
  const tx = fakeTx(FRESH, { INTAKE: "ACTIVE", DIAGNOSIS: "NOT_STARTED", PROCESS: "NOT_STARTED", QC: "NOT_STARTED", HANDOFF: "NOT_STARTED" });
  await conflict(() => transitionPhases(tx, "r1", [{ phase: "PROCESS", data: { status: "ACTIVE" } }]), "PHASE_MULTIPLE_IN_PROGRESS");
  assert.deepEqual(tx.writes, []);
  assert.equal(tx.rows.find((row) => row.phase === "INTAKE").status, "ACTIVE");
});

test("transitionPhases pada run legacy/backfill: perilaku lama (tanpa pemeriksaan invariant)", async () => {
  const tx = fakeTx(LEGACY, { INTAKE: "ACTIVE", PROCESS: "NOT_STARTED" });
  await transitionPhases(tx, "r1", [{ phase: "PROCESS", data: { status: "ACTIVE" } }]);
  assert.deepEqual(tx.writes, [["PROCESS", "ACTIVE"]]);
});

test("assertRunPhasesTerminal: fase tertinggal menolak 409 (tanpa auto-close); run legacy tidak diperiksa", async () => {
  const done = { INTAKE: "COMPLETED", DIAGNOSIS: "NOT_APPLICABLE", PROCESS: "COMPLETED", QC: "COMPLETED", HANDOFF: "COMPLETED" };
  await assertRunPhasesTerminal(fakeTx(FRESH, done), "r1");
  const left = fakeTx(FRESH, { ...done, INTAKE: "ACTIVE" });
  await conflict(() => assertRunPhasesTerminal(left, "r1"), "RUN_PHASES_NOT_TERMINAL");
  assert.deepEqual(left.writes, [], "tidak ada penutupan otomatis");
  await conflict(() => assertRunPhasesTerminal(fakeTx(FRESH, { ...done, HANDOFF: "ACTIVE" }), "r1"), "RUN_PHASES_NOT_TERMINAL");
  await conflict(() => assertRunPhasesTerminal(fakeTx(FRESH, { ...done, HANDOFF: "NOT_APPLICABLE" }), "r1"), "RUN_HANDOFF_NOT_COMPLETED");
  await assertRunPhasesTerminal(fakeTx(FRESH, { ...done, HANDOFF: "NOT_APPLICABLE" }), "r1", { requireHandoffCompleted: false });
  await assertRunPhasesTerminal(fakeTx(LEGACY, { INTAKE: "MIGRATION_REVIEW", HANDOFF: "NOT_STARTED" }), "r1");
});

test("keputusan Gudang dini: fase selain HANDOFF wajib terminal; run legacy dilewati", () => {
  const ok = { origin: "CUSTODY_PICKUP", phases: phases({ INTAKE: "COMPLETED", DIAGNOSIS: "NOT_APPLICABLE", PROCESS: "COMPLETED", QC: "COMPLETED", HANDOFF: "ACTIVE" }) };
  assert.doesNotThrow(() => assertPhasesReadyForHandoffDecision(ok));
  const bad = { origin: "CUSTODY_PICKUP", phases: phases({ INTAKE: "ACTIVE", DIAGNOSIS: "NOT_STARTED", PROCESS: "COMPLETED", QC: "COMPLETED", HANDOFF: "ACTIVE" }) };
  assert.throws(() => assertPhasesReadyForHandoffDecision(bad), (error) => error.statusCode === 409 && error.code === "RUN_PHASES_NOT_TERMINAL" && error.details.phases.join() === "INTAKE,DIAGNOSIS");
  assert.doesNotThrow(() => assertPhasesReadyForHandoffDecision({ ...bad, origin: null, migrationSource: "x" }));
});

test("audit writer fase pada source aktual: 0 pelanggaran; mutasi hanya di helper; tiap penyelesaian run dijaga", () => {
  const report = runPhaseLifecycleWriterAudit(backendRoot);
  assert.equal(report.totals.violations, 0, JSON.stringify(report.findings.filter((f) => !f.ok)));
  assert.ok(report.totals.mutations >= 1 && report.findings.filter((f) => f.kind === "PHASE_MUTATION").every((f) => f.file === "src/services/productionPhaseLifecycle.js"));
  // 3 penutup run: custody (barang jadi) + P6 (override V1) + custody (completeAdaptationRunInTx, slice 2 — hanya run ADAPTATION_V1, fase QC/HANDOFF NOT_APPLICABLE). Ketiganya dijaga assertRunPhasesTerminal dan berada di owner custody/P6.
  assert.equal(report.totals.runCompletions, 3);
  assert.ok(report.findings.filter((f) => f.kind === "RUN_COMPLETION").every((f) => /unitCustodyCommandService|productionQcHandoffCommandService/.test(f.file)), "penutup run hanya di owner custody/P6");
  assert.equal(report.totals.rawSqlWrites, 0);
});

test("audit writer fase gagal: penulis di luar owner, SQL mentah, penyelesaian run tanpa guard, owner tidak memakai helper", () => {
  const sources = loadBackendSources(backendRoot);
  const bad = new Map(sources);
  bad.set("src/routes/liar.js", [
    "await tx.productionPhaseRun.update({ where: {}, data: {} });",
    "await tx.productionPhaseRun.updateMany({});",
    "await tx.productionPhaseRun.create({ data: {} });",
    "await tx.$executeRawUnsafe('UPDATE production_phase_runs_v2 SET status = 1');",
    "await tx.productionRun.update({ where: {}, data: { status: \"COMPLETED\" } });",
  ].join("\n"));
  const dispositions = auditPhaseLifecycleWriters(bad).findings.filter((f) => !f.ok).map((f) => f.disposition).sort();
  assert.deepEqual(dispositions, ["FORBIDDEN_RAW_SQL_WRITE", "MISSING_PHASE_TERMINAL_GUARD", "UNOWNED_CREATION_create", "UNOWNED_MUTATION_update", "UNOWNED_MUTATION_updateMany"]);

  const CUSTODY = "src/services/unitCustodyCommandService.js";
  const noHelper = new Map(sources);
  noHelper.set(CUSTODY, sources.get(CUSTODY).replaceAll("transitionPhases", "renamedTransition"));
  assert.ok(auditPhaseLifecycleWriters(noHelper).findings.some((f) => f.disposition === "OWNER_DOES_NOT_USE_TRANSITION_HELPER" && f.file === CUSTODY));

  const unguarded = new Map(sources);
  unguarded.set(CUSTODY, sources.get(CUSTODY).replaceAll("assertRunPhasesTerminal(tx, finishedRun.id)", "Promise.resolve()"));
  assert.ok(auditPhaseLifecycleWriters(unguarded).findings.some((f) => f.disposition === "MISSING_PHASE_TERMINAL_GUARD" && f.file === CUSTODY));

  const direct = new Map(sources);
  direct.set("src/services/productionQcHandoffCommandService.js", `${sources.get("src/services/productionQcHandoffCommandService.js")}\nawait tx.productionPhaseRun.update({ where: {}, data: {} });\n`);
  assert.ok(auditPhaseLifecycleWriters(direct).findings.some((f) => f.disposition === "UNOWNED_MUTATION_update"));
});
