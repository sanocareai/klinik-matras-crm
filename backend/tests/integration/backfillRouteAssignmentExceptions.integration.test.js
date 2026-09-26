import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { applyPlan, buildExceptions, loadSource, unitPlan } from "../../scripts/production-delivery-v2/backfill-core.js";
import { persistMigrationExceptions, withSavepoint } from "../../scripts/production-delivery-v2/migration-exception-persistence.js";
import { checksum } from "../../scripts/production-delivery-v2/common.js";
import { blockedRouteIdsV2, readDriverFullSnapshot } from "../../src/services/driverSnapshotV2.js";

const CODE = "ROUTE_JOB_ASSIGNMENT_MISMATCH";
const DATE = new Date("2026-09-25T00:00:00.000Z");
const SECRET = "test-secret-at-least-sixteen-characters";

test.beforeEach(async () => { await truncateAll(); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await testPrisma.$disconnect(); });

async function backfill(options) {
  const source = await loadSource(testPrisma);
  const plans = source.units.map(unitPlan);
  const exceptions = buildExceptions(source.units, source.routes, source.jobs);
  return applyPlan(testPrisma, source, plans, exceptions, options);
}

async function world() {
  const [{ user: driver }, { user: helper }, { user: otherDriver }] = await Promise.all([
    createTestUser({ roles: ["DRIVER"] }), createTestUser({ roles: ["HELPER"] }), createTestUser({ roles: ["DRIVER"] }),
  ]);
  const customer = await testPrisma.customer.create({ data: { name: "Fixture" } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, value: 0, status: "DELIVERED" } });
  return { driver, helper, otherDriver, order };
}

async function makeRoute(w, code, status = "PUBLISHED") {
  return testPrisma.route.create({ data: { code, status, date: DATE, driverId: w.driver.id, helperId: w.helper.id } });
}

// mismatch=true -> job memakai crew yang berbeda dari header route.
async function makeJob(w, route, { mismatch = false, sequence } = {}) {
  return testPrisma.job.create({
    data: {
      type: "DELIVERY", orderId: w.order.id, routeId: route.id, status: "ASSIGNED", sequence, scheduledDate: DATE,
      driverId: mismatch ? w.otherDriver.id : w.driver.id, helperId: w.helper.id,
    },
  });
}

const mismatchRows = (where = {}) => testPrisma.v2MigrationException.findMany({ where: { code: CODE, ...where }, orderBy: { createdAt: "asc" } });

async function resolve(exceptionId, provenance = "OPS_ROUTE_ASSIGNMENT_DECISION") {
  return testPrisma.v2MigrationException.update({
    where: { id: exceptionId },
    data: { status: "RESOLVED", resolution: { provenance, decision: "ADOPT_JOB_CREW" }, resolvedById: "OPS_TEST", resolvedAt: new Date("2026-09-27T00:00:00.000Z") },
  });
}

test("1. satu route dengan banyak job mismatch menghasilkan TEPAT SATU exception", async () => {
  const w = await world();
  const route = await makeRoute(w, "RTE-A");
  for (let i = 1; i <= 6; i += 1) await makeJob(w, route, { mismatch: true, sequence: i });
  await makeJob(w, route, { mismatch: false, sequence: 7 });
  const result = await backfill();
  assert.equal(result.status, "VERIFIED");
  assert.deepEqual(result.failures, []);
  const rows = await mismatchRows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].aggregateId, route.id);
  assert.equal(rows[0].evidence.mismatchedJobs.length, 6);
});

test("2. dua route bermasalah menghasilkan dua exception", async () => {
  const w = await world();
  const a = await makeRoute(w, "RTE-A");
  const b = await makeRoute(w, "RTE-B");
  await makeJob(w, a, { mismatch: true, sequence: 1 });
  await makeJob(w, a, { mismatch: true, sequence: 2 });
  await makeJob(w, b, { mismatch: true, sequence: 1 });
  await backfill();
  const rows = await mismatchRows();
  assert.deepEqual(rows.map((row) => row.aggregateId).sort(), [a.id, b.id].sort());
});

test("3. evidence lengkap: field berbeda, nilai header route dan nilai job, urut deterministik", async () => {
  const w = await world();
  const route = await makeRoute(w, "RTE-A");
  const jobs = [];
  for (let i = 1; i <= 5; i += 1) jobs.push(await makeJob(w, route, { mismatch: true, sequence: i }));
  await backfill();
  const [row] = await mismatchRows();
  const ids = row.evidence.mismatchedJobs.map((item) => item.jobId);
  assert.deepEqual(ids, jobs.map((item) => item.id).sort());
  assert.deepEqual(row.evidence.header, { driverId: w.driver.id, helperId: w.helper.id, vehicleId: null, scheduledDate: "2026-09-25" });
  for (const item of row.evidence.mismatchedJobs) {
    assert.deepEqual(item.differences, [{ field: "driverId", route: w.driver.id, job: w.otherDriver.id }]);
  }
});

test("4. replay idempoten: tanpa duplikasi exception, state, publication, dan assignment", async () => {
  const w = await world();
  const route = await makeRoute(w, "RTE-A");
  for (let i = 1; i <= 3; i += 1) await makeJob(w, route, { mismatch: true, sequence: i });
  const first = await backfill();
  const counts = async () => ({
    states: await testPrisma.deliveryJobState.count(),
    publications: await testPrisma.routePublication.count(),
    assignments: await testPrisma.routeStopAssignment.count(),
    routeStates: await testPrisma.deliveryRouteState.count(),
  });
  const before = await counts();
  const replay = await backfill();
  assert.deepEqual(await counts(), before);
  assert.notEqual(first.migrationRunId, replay.migrationRunId);
  for (const runId of [first.migrationRunId, replay.migrationRunId]) {
    assert.equal(await testPrisma.v2MigrationException.count({ where: { runId, code: CODE } }), 1, "satu exception per run");
  }
  const [one, two] = await mismatchRows();
  assert.equal(checksum(one.evidence), checksum(two.evidence), "fingerprint stabil antar-run");
  assert.equal(two.status, one.status);

  // Persist berulang di run yang sama juga tidak menggandakan baris.
  const run = await testPrisma.v2MigrationRun.create({ data: { kind: "INITIAL_BACKFILL", status: "RUNNING" } });
  const exception = buildExceptions([], (await loadSource(testPrisma)).routes, []).find((item) => item.code === CODE);
  await testPrisma.$transaction(async (tx) => {
    await persistMigrationExceptions(tx, { runId: run.id, exceptions: [exception] });
    await persistMigrationExceptions(tx, { runId: run.id, exceptions: [exception] });
  });
  assert.equal(await testPrisma.v2MigrationException.count({ where: { runId: run.id, code: CODE } }), 1);
});

test("5. RESOLVED dengan fingerprint sama tetap RESOLVED pada catch-up berikutnya", async () => {
  const w = await world();
  const route = await makeRoute(w, "RTE-A");
  await makeJob(w, route, { mismatch: true, sequence: 1 });
  await makeJob(w, route, { mismatch: true, sequence: 2 });
  await backfill();
  const [first] = await mismatchRows();
  await resolve(first.id);
  const replay = await backfill();
  const rows = await mismatchRows({ runId: replay.migrationRunId });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "RESOLVED");
  assert.equal(rows[0].resolution.provenance, "OPS_ROUTE_ASSIGNMENT_DECISION");
  assert.equal(rows[0].resolvedById, "OPS_TEST");
  assert.deepEqual(await blockedRouteIdsV2(testPrisma), [], "route yang sudah RESOLVED tidak diblokir");
});

test("6. evidence berubah setelah RESOLVED membuka kembali exception dan mempertahankan histori", async () => {
  const w = await world();
  const route = await makeRoute(w, "RTE-A");
  await makeJob(w, route, { mismatch: true, sequence: 1 });
  await backfill();
  const [first] = await mismatchRows();
  await resolve(first.id);
  await backfill(); // RESOLVED terbawa
  await makeJob(w, route, { mismatch: true, sequence: 2 }); // mismatch baru
  const reopenedRun = await backfill();
  const [reopened] = await mismatchRows({ runId: reopenedRun.migrationRunId });
  assert.equal(reopened.status, "OPEN");
  assert.equal(reopened.resolvedAt, null);
  assert.equal(reopened.evidence.mismatchedJobs.length, 2);
  assert.equal(reopened.resolution.reopened, true);
  assert.equal(reopened.resolution.reason, "EVIDENCE_CHANGED");
  assert.equal(reopened.resolution.previous.resolution.provenance, "OPS_ROUTE_ASSIGNMENT_DECISION");
  assert.equal(reopened.resolution.previous.resolvedById, "OPS_TEST");
  assert.deepEqual(await blockedRouteIdsV2(testPrisma), [route.id]);

  // Catch-up berikutnya tanpa perubahan: tetap OPEN (tidak turun diam-diam) dengan histori yang sama.
  const again = await backfill();
  const [stillOpen] = await mismatchRows({ runId: again.migrationRunId });
  assert.equal(stillOpen.status, "OPEN");
  assert.equal(stillOpen.resolution.previous.resolution.provenance, "OPS_ROUTE_ASSIGNMENT_DECISION");
});

test("7. route bermasalah tersaring dari snapshot Reader V2 sampai exception-nya RESOLVED", async () => {
  const w = await world();
  const bad = await makeRoute(w, "RTE-BAD");
  await makeJob(w, bad, { mismatch: true, sequence: 1 });
  await backfill();
  // Driver header route tidak punya job miliknya sendiri -> eligible, tetapi route bermasalah tidak boleh muncul.
  const blocked = await readDriverFullSnapshot(testPrisma, { userId: w.driver.id, limit: 10, secret: SECRET });
  assert.deepEqual(blocked.items, []);

  // Ops memutuskan: job mengikuti crew header route (V1 dikoreksi) lalu exception ditandai RESOLVED.
  // Tanpa koreksi V1, guard drift assignment tetap memblokir cohort Driver (fail-closed berlapis).
  const [row] = await mismatchRows();
  await testPrisma.job.updateMany({ where: { routeId: bad.id }, data: { driverId: w.driver.id } });
  await resolve(row.id);
  const open = await readDriverFullSnapshot(testPrisma, { userId: w.driver.id, limit: 10, secret: SECRET });
  assert.deepEqual(open.items.map((item) => item.routeId), [bad.id]);
});

test("8. satu route gagal tidak menggagalkan batch: route/job lain selesai, kegagalan tercatat OPEN", async () => {
  const w = await world();
  const good = await makeRoute(w, "RTE-GOOD");
  const bad = await makeRoute(w, "RTE-FAIL");
  const goodJob = await makeJob(w, good, { mismatch: false, sequence: 1 });
  const badJob = await makeJob(w, bad, { mismatch: true, sequence: 1 });
  const result = await backfill({ beforeRoute: (route) => { if (route.id === bad.id) throw new Error("simulasi kegagalan route"); } });

  assert.equal(result.status, "FAILED");
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].aggregateId, bad.id);
  assert.equal(result.failures[0].code, "ROUTE_BACKFILL_FAILED");
  const run = await testPrisma.v2MigrationRun.findUnique({ where: { id: result.migrationRunId } });
  assert.equal(run.status, "FAILED");
  assert.equal(run.metadata.partial, true);

  assert.ok(await testPrisma.deliveryRouteState.findUnique({ where: { routeId: good.id } }), "route sehat tetap selesai");
  assert.equal(await testPrisma.deliveryRouteState.findUnique({ where: { routeId: bad.id } }), null);
  assert.equal(await testPrisma.deliveryJobState.count({ where: { jobId: { in: [goodJob.id, badJob.id] } } }), 2, "job lain tetap di-backfill");
  const failure = await testPrisma.v2MigrationException.findFirst({ where: { code: "ROUTE_BACKFILL_FAILED", aggregateId: bad.id } });
  assert.equal(failure.status, "OPEN");
  assert.equal((await mismatchRows()).length, 1, "exception mismatch route bermasalah tetap tersimpan");
  assert.deepEqual(await blockedRouteIdsV2(testPrisma), [bad.id]);
});

test("savepoint memulihkan transaksi setelah error database (bukan hanya error klien)", async () => {
  await testPrisma.$transaction(async (tx) => {
    const failed = await withSavepoint(tx, "sp_test", () => tx.$executeRawUnsafe("SELECT 1/0"));
    assert.equal(failed.ok, false);
    const rows = await tx.$queryRawUnsafe("SELECT 1 AS x");
    assert.equal(Number(rows[0].x), 1, "transaksi tidak teracuni (25P02)");
  });
});
