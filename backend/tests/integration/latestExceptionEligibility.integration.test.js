import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { applyPlan, buildExceptions, loadSource, unitPlan } from "../../scripts/production-delivery-v2/backfill-core.js";
import { blockedRouteIdsV2, driverV2Eligibility } from "../../src/services/driverSnapshotV2.js";

const DATE = new Date("2026-09-25T00:00:00.000Z");
test.beforeEach(async () => { await truncateAll(); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await testPrisma.$disconnect(); });

async function publishedRouteWithDriverJob() {
  const [{ user: driver }, { user: helper }] = await Promise.all([createTestUser({ roles: ["DRIVER"] }), createTestUser({ roles: ["HELPER"] })]);
  const customer = await testPrisma.customer.create({ data: { name: "Fixture" } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, value: 0, status: "PROCESSING" } });
  const route = await testPrisma.route.create({ data: { code: "RTE-E", status: "PUBLISHED", date: DATE, driverId: driver.id, helperId: helper.id } });
  const job = await testPrisma.job.create({
    data: { type: "DELIVERY", orderId: order.id, routeId: route.id, status: "ASSIGNED", sequence: 1, scheduledDate: DATE, driverId: driver.id, helperId: helper.id },
  });
  const source = await loadSource(testPrisma);
  await applyPlan(testPrisma, source, source.units.map(unitPlan), buildExceptions(source.units, source.routes, source.jobs));
  return { driver, route, job };
}

let clock = Date.parse("2026-09-26T00:00:00.000Z");
// Satu run backfill baru dengan satu exception (createdAt naik monoton supaya urutan "terbaru" eksplisit).
async function run(aggregateId, code, status, aggregateType = "Route") {
  clock += 60_000;
  const migrationRun = await testPrisma.v2MigrationRun.create({ data: { kind: "INITIAL_BACKFILL", status: "VERIFIED", createdAt: new Date(clock) } });
  return testPrisma.v2MigrationException.create({
    data: {
      runId: migrationRun.id, domain: "DELIVERY", aggregateType, aggregateId, code, severity: "CRITICAL", status,
      evidence: { run: clock }, createdAt: new Date(clock),
      ...(status === "RESOLVED" ? { resolution: { provenance: "OPS_ROUTE_ASSIGNMENT_DECISION" }, resolvedAt: new Date(clock) } : {}),
    },
  });
}

test("eligibility hanya membaca exception TERBARU per (route, code) lintas beberapa run backfill", async () => {
  const fx = await publishedRouteWithDriverJob();
  assert.equal((await driverV2Eligibility(testPrisma, fx.driver.id)).eligible, true, "tanpa exception: eligible");

  await run(fx.route.id, "CODE_A", "KEEP_V1"); // run 1: terbuka
  let result = await driverV2Eligibility(testPrisma, fx.driver.id);
  assert.equal(result.eligible, false);
  assert.deepEqual(result.blockers.map((b) => b.code), ["MIGRATION_KEEP_V1:CODE_A"]);

  await run(fx.route.id, "CODE_A", "RESOLVED"); // run 2: terbaru RESOLVED -> baris lama superseded
  result = await driverV2Eligibility(testPrisma, fx.driver.id);
  assert.equal(result.eligible, true, "RESOLVED terbaru tidak memblokir walau run lama masih KEEP_V1");
  assert.deepEqual(await blockedRouteIdsV2(testPrisma), []);

  await run(fx.route.id, "CODE_A", "OPEN"); // run 3: dibuka lagi
  result = await driverV2Eligibility(testPrisma, fx.driver.id);
  assert.deepEqual(result.blockers.map((b) => b.code), ["MIGRATION_OPEN:CODE_A"], "hanya SATU blocker (baris terbaru), bukan tiga");
  assert.deepEqual(await blockedRouteIdsV2(testPrisma), [fx.route.id]);

  await run(fx.route.id, "CODE_A", "RESOLVED"); // run 4
  await run(fx.route.id, "CODE_B", "KEEP_V1"); // kode lain berdiri sendiri
  result = await driverV2Eligibility(testPrisma, fx.driver.id);
  assert.deepEqual(result.blockers.map((b) => b.code), ["MIGRATION_KEEP_V1:CODE_B"]);
  assert.deepEqual(await blockedRouteIdsV2(testPrisma), [fx.route.id]);

  await run(fx.route.id, "CODE_B", "RESOLVED");
  assert.equal((await driverV2Eligibility(testPrisma, fx.driver.id)).eligible, true);
  assert.deepEqual(await blockedRouteIdsV2(testPrisma), []);
});

test("exception level Job mengikuti aturan terbaru yang sama", async () => {
  const fx = await publishedRouteWithDriverJob();
  await run(fx.job.id, "ACTIVE_ORPHAN_JOB", "KEEP_V1", "Job");
  assert.equal((await driverV2Eligibility(testPrisma, fx.driver.id)).eligible, false);
  await run(fx.job.id, "ACTIVE_ORPHAN_JOB", "RESOLVED", "Job");
  assert.equal((await driverV2Eligibility(testPrisma, fx.driver.id)).eligible, true);
});
