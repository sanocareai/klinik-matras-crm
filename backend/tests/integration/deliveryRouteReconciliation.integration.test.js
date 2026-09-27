import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { deliveryV2Checksum } from "../../src/services/deliveryV2Snapshot.js";
import {
  DELIVERY_ROUTE_RECONCILIATION_MODE,
  reconcileDeliveryRouteFromV1,
} from "../../src/services/deliveryRouteReconciliation.js";

async function base({ code, status = "PUBLISHED" }) {
  const [{ user: driver }, { user: helper }] = await Promise.all([
    createTestUser({ roles: ["DRIVER"] }),
    createTestUser({ roles: ["HELPER"] }),
  ]);
  const customer = await testPrisma.customer.create({ data: { name: code } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, value: 0, status: "DELIVERED" } });
  const route = await testPrisma.route.create({
    data: {
      code, status, date: new Date("2026-09-25T00:00:00.000Z"),
      driverId: driver.id, helperId: helper.id,
    },
  });
  return { driver, helper, customer, order, route };
}

async function job(fixture, { status, sequence, routeId = fixture.route.id } = {}) {
  return testPrisma.job.create({
    data: {
      type: "DELIVERY", orderId: fixture.order.id, routeId,
      status, sequence, scheduledDate: new Date("2026-09-25T00:00:00.000Z"),
      driverId: fixture.driver.id, helperId: fixture.helper.id,
      ...(status === "COMPLETED" ? { completedAt: new Date("2026-09-25T08:00:00.000Z") } : {}),
    },
  });
}

test.beforeEach(async () => { await truncateAll(); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await testPrisma.$disconnect(); });

test("RTE-240926-02: enam completed dipetakan, lima active dan dua extra direvoke lewat publication baru", async () => {
  const fixture = await base({ code: "RTE-240926-02" });
  const canonical = [];
  for (let sequence = 1; sequence <= 6; sequence += 1) canonical.push(await job(fixture, { status: "COMPLETED", sequence }));
  const otherRoute = await testPrisma.route.create({
    data: { code: "RTE-OTHER", status: "PUBLISHED", date: new Date("2026-09-25T00:00:00.000Z"), driverId: fixture.driver.id, helperId: fixture.helper.id },
  });
  const extras = [
    await job(fixture, { status: "ASSIGNED", sequence: 7, routeId: otherRoute.id }),
    await job(fixture, { status: "ASSIGNED", sequence: 8, routeId: otherRoute.id }),
  ];
  const staleSnapshot = {
    schemaVersion: 1, routeId: fixture.route.id, code: fixture.route.code,
    status: "PUBLISHED", driverId: fixture.driver.id, helperId: fixture.helper.id,
    stops: [...canonical, ...extras].map((item) => ({ jobId: item.id, status: item.status, sequence: item.sequence })),
  };
  await testPrisma.deliveryRouteState.create({
    data: { routeId: fixture.route.id, routeRevision: 1, currentPublicationVersion: 1, lifecycleStatus: "PUBLISHED", draftSnapshot: staleSnapshot },
  });
  await testPrisma.routePublication.create({
    data: {
      routeId: fixture.route.id, publicationVersion: 1, routeRevision: 1,
      status: "ACTIVE", snapshot: staleSnapshot, checksum: deliveryV2Checksum(staleSnapshot),
      assignments: {
        create: [...canonical, ...extras].map((item, index) => ({
          jobId: item.id, sequence: index + 1,
          driverId: fixture.driver.id, helperId: fixture.helper.id,
          status: index < 3 ? "COMPLETED" : "ACTIVE",
        })),
      },
    },
  });
  const input = {
    routeId: fixture.route.id,
    actorId: "OWNER_TEST",
    idempotencyKey: "reconcile-rte-240926-02-test",
    mode: DELIVERY_ROUTE_RECONCILIATION_MODE.TERMINAL_ASSIGNMENTS,
    reason: "test canonical terminal reconciliation",
    expected: { v1JobCount: 6, v2AssignmentCount: 8 },
  };
  const first = await reconcileDeliveryRouteFromV1(testPrisma, input);
  const replay = await reconcileDeliveryRouteFromV1(testPrisma, input);
  assert.equal(first.evidence.sourceJobIds.length, 6);
  assert.equal(first.evidence.activeAssignmentIds.length, 5);
  assert.equal(first.evidence.extraAssignments.length, 2);
  assert.equal(replay.replayed, true);
  const publications = await testPrisma.routePublication.findMany({
    where: { routeId: fixture.route.id }, orderBy: { publicationVersion: "asc" }, include: { assignments: true },
  });
  assert.equal(publications.length, 2);
  assert.equal(publications[0].status, "SUPERSEDED");
  assert.equal(publications[0].assignments.filter((item) => item.status === "ACTIVE").length, 0);
  assert.equal(publications[0].assignments.filter((item) => item.status === "REVOKED").length, 5);
  assert.equal(publications[1].assignments.length, 6);
  assert.equal(publications[1].assignments.every((item) => item.status === "COMPLETED"), true);
  assert.equal(await testPrisma.job.count(), 8);
  assert.equal(await testPrisma.route.count(), 2);
  const feed = await testPrisma.driverSyncEvent.findMany({ orderBy: [{ userId: "asc" }, { sequence: "asc" }] });
  assert.deepEqual(feed.map((item) => item.kind), ["REMOVE_ROUTE", "REMOVE_ROUTE"]);
});

test("route V1 yang sudah COMPLETED dengan Job terminal direkonsiliasi menjadi publication revoked dan REMOVE_ROUTE", async () => {
  const fixture = await base({ code: "RTE-TERMINAL-CATCHUP", status: "COMPLETED" });
  const completed = await job(fixture, { status: "COMPLETED", sequence: 1 });
  const failed = await job(fixture, { status: "FAILED", sequence: 2 });
  const staleSnapshot = {
    schemaVersion: 1, routeId: fixture.route.id, code: fixture.route.code,
    status: "PUBLISHED", driverId: fixture.driver.id, helperId: fixture.helper.id,
    stops: [completed, failed].map((item) => ({ jobId: item.id, status: item.status, sequence: item.sequence })),
  };
  await testPrisma.deliveryRouteState.create({
    data: {
      routeId: fixture.route.id, routeRevision: 1, currentPublicationVersion: 1,
      lifecycleStatus: "PUBLISHED", draftSnapshot: staleSnapshot,
    },
  });
  await testPrisma.routePublication.create({
    data: {
      routeId: fixture.route.id, publicationVersion: 1, routeRevision: 1,
      status: "ACTIVE", snapshot: staleSnapshot, checksum: deliveryV2Checksum(staleSnapshot),
      assignments: {
        create: [completed, failed].map((item) => ({
          jobId: item.id, sequence: item.sequence, driverId: fixture.driver.id,
          helperId: fixture.helper.id, status: "ACTIVE",
        })),
      },
    },
  });
  const input = {
    routeId: fixture.route.id,
    actorId: "OWNER_TEST",
    idempotencyKey: "reconcile-terminal-completed-test",
    mode: DELIVERY_ROUTE_RECONCILIATION_MODE.TERMINAL_ASSIGNMENTS,
    reason: "catch up terminal lifecycle from canonical V1",
    expected: { v1JobCount: 2, v2AssignmentCount: 2 },
  };

  const first = await reconcileDeliveryRouteFromV1(testPrisma, input);
  const replay = await reconcileDeliveryRouteFromV1(testPrisma, input);
  assert.equal(first.publication.status, "REVOKED");
  assert.equal(replay.replayed, true);
  const state = await testPrisma.deliveryRouteState.findUnique({ where: { routeId: fixture.route.id } });
  assert.equal(state.lifecycleStatus, "COMPLETED");
  const latest = await testPrisma.routePublication.findUnique({
    where: { routeId_publicationVersion: { routeId: fixture.route.id, publicationVersion: 2 } },
    include: { assignments: true },
  });
  assert.equal(latest.status, "REVOKED");
  assert.equal(latest.assignments.every((item) => item.status === "REVOKED"), true);
  const feed = await testPrisma.driverSyncEvent.findMany({ orderBy: [{ userId: "asc" }, { sequence: "asc" }] });
  assert.deepEqual(feed.map((item) => item.kind), ["REMOVE_ROUTE", "REMOVE_ROUTE"]);
});

async function seedCatchUp({ ambiguous = false } = {}) {
  const fixture = await base({ code: ambiguous ? "RTE-CATCHUP-BLOCK" : "RTE-250926-01" });
  const jobs = [];
  for (let sequence = 1; sequence <= 8; sequence += 1) jobs.push(await job(fixture, { status: "ASSIGNED", sequence }));
  if (ambiguous) await testPrisma.job.update({ where: { id: jobs[0].id }, data: { helperId: null } });
  const draft = { routeId: fixture.route.id, code: fixture.route.code, status: "DRAFT", stops: [] };
  await testPrisma.deliveryRouteState.create({
    data: { routeId: fixture.route.id, routeRevision: 1, currentPublicationVersion: null, lifecycleStatus: "DRAFT", draftSnapshot: draft, migrationSource: "ROUTE_V1" },
  });
  const run = await testPrisma.v2MigrationRun.create({ data: { kind: "INITIAL_BACKFILL", status: "VERIFIED", sourceChecksum: "test" } });
  const exception = await testPrisma.v2MigrationException.create({
    data: {
      runId: run.id, domain: "DELIVERY", aggregateType: "Route", aggregateId: fixture.route.id,
      code: "ROUTE_JOB_ASSIGNMENT_MISMATCH", severity: "CRITICAL", status: "KEEP_V1",
      evidence: { jobId: jobs[0].id },
    },
  });
  return { ...fixture, jobs, exception };
}

test("RTE-250926-01: catch-up membuat satu publication delapan Job aktif dan menutup exception", async () => {
  const fixture = await seedCatchUp();
  const input = {
    routeId: fixture.route.id,
    actorId: "OWNER_TEST",
    idempotencyKey: "catchup-rte-250926-01-test",
    mode: DELIVERY_ROUTE_RECONCILIATION_MODE.PUBLISHED_CATCH_UP,
    reason: "test canonical catch-up",
    exceptionId: fixture.exception.id,
    expected: { v1JobCount: 8 },
  };
  const first = await reconcileDeliveryRouteFromV1(testPrisma, input);
  const replay = await reconcileDeliveryRouteFromV1(testPrisma, input);
  assert.equal(first.evidence.sourceJobIds.length, 8);
  assert.equal(replay.replayed, true);
  const publication = await testPrisma.routePublication.findFirst({ where: { routeId: fixture.route.id }, include: { assignments: true } });
  assert.equal(publication.status, "ACTIVE");
  assert.equal(publication.assignments.length, 8);
  assert.equal(publication.assignments.every((item) => item.status === "ACTIVE"), true);
  assert.equal(await testPrisma.v2MigrationException.count({ where: { id: fixture.exception.id, status: "RESOLVED" } }), 1);
  assert.equal(await testPrisma.v2Command.count({ where: { commandType: "CATCH_UP_PUBLISHED_ROUTE_FROM_V1" } }), 1);
});

test("catch-up ambigu tetap KEEP_V1 dan rollback tanpa publication/feed", async () => {
  const fixture = await seedCatchUp({ ambiguous: true });
  await assert.rejects(reconcileDeliveryRouteFromV1(testPrisma, {
    routeId: fixture.route.id,
    actorId: "OWNER_TEST",
    idempotencyKey: "catchup-ambiguous-route-test",
    mode: DELIVERY_ROUTE_RECONCILIATION_MODE.PUBLISHED_CATCH_UP,
    reason: "must stay keep v1",
    exceptionId: fixture.exception.id,
    expected: { v1JobCount: 8 },
  }), (error) => error.code === "ROUTE_JOB_ASSIGNMENT_AMBIGUOUS");
  assert.equal(await testPrisma.v2MigrationException.count({ where: { id: fixture.exception.id, status: "KEEP_V1" } }), 1);
  assert.equal(await testPrisma.routePublication.count({ where: { routeId: fixture.route.id } }), 0);
  assert.equal(await testPrisma.driverSyncEvent.count(), 0);
  assert.equal(await testPrisma.v2Command.count({ where: { aggregateId: fixture.route.id } }), 0);
});
