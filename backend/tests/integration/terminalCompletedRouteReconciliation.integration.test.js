import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { deliveryV2Checksum } from "../../src/services/deliveryV2Snapshot.js";
import {
  RECONCILIATION_TARGETS, runTerminalCompletedRouteReconciliation,
} from "../../scripts/production-delivery-v2/reconcile-driver-route-exceptions.js";

test.beforeEach(async () => { await truncateAll(); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await testPrisma.$disconnect(); });

const DATE = new Date("2026-09-25T00:00:00.000Z");

// Meniru RTE-250926-01: V1 COMPLETED (6 COMPLETED + 2 FAILED), V2 masih PUBLISHED revisi 2 dengan 8 assignment ACTIVE.
async function seed() {
  const target = RECONCILIATION_TARGETS.terminalCompleted;
  const [{ user: driver }, { user: helper }] = await Promise.all([createTestUser({ roles: ["DRIVER"] }), createTestUser({ roles: ["HELPER"] })]);
  const customer = await testPrisma.customer.create({ data: { name: "Fixture" } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, value: 0, status: "DELIVERED" } });
  const route = await testPrisma.route.create({
    data: { id: target.id, code: target.code, status: "COMPLETED", date: DATE, driverId: driver.id, helperId: helper.id },
  });
  const jobs = [];
  for (let sequence = 1; sequence <= 8; sequence += 1) {
    jobs.push(await testPrisma.job.create({
      data: {
        type: "DELIVERY", orderId: order.id, routeId: route.id, sequence, scheduledDate: DATE,
        status: sequence <= 6 ? "COMPLETED" : "FAILED", driverId: driver.id, helperId: helper.id,
        ...(sequence <= 6 ? { completedAt: new Date("2026-09-25T08:00:00.000Z") } : {}),
      },
    }));
  }
  const snapshot = {
    schemaVersion: 1, routeId: route.id, code: route.code, status: "PUBLISHED", driverId: driver.id, helperId: helper.id,
    stops: jobs.map((job) => ({ jobId: job.id, status: job.status, sequence: job.sequence })),
  };
  await testPrisma.deliveryRouteState.create({
    data: { routeId: route.id, routeRevision: 2, currentPublicationVersion: 1, lifecycleStatus: "PUBLISHED", draftSnapshot: snapshot, migrationSource: "ROUTE_V1" },
  });
  await testPrisma.routePublication.create({
    data: {
      routeId: route.id, publicationVersion: 1, routeRevision: 2, status: "ACTIVE", snapshot, checksum: deliveryV2Checksum(snapshot),
      assignments: { create: jobs.map((job) => ({ jobId: job.id, sequence: job.sequence, driverId: driver.id, helperId: helper.id, status: "ACTIVE" })) },
    },
  });
  return { route, jobs, driver, helper };
}

const counts = async () => ({
  commands: await testPrisma.v2Command.count(),
  publications: await testPrisma.routePublication.count(),
  assignments: await testPrisma.routeStopAssignment.count(),
  feed: await testPrisma.driverSyncEvent.count(),
  outbox: await testPrisma.domainOutbox.count(),
});

test("terminal reconcile RTE-250926-01: V1 tidak berubah, V2 PUBLISHED -> COMPLETED, feed/outbox sesuai kontrak, replay idempoten", async () => {
  const fx = await seed();
  const v1Before = JSON.stringify({
    route: await testPrisma.route.findUnique({ where: { id: fx.route.id } }),
    jobs: await testPrisma.job.findMany({ where: { routeId: fx.route.id }, orderBy: { id: "asc" } }),
  });
  const before = await counts();

  const dry = await runTerminalCompletedRouteReconciliation(testPrisma, { apply: false });
  assert.equal(dry.mode, "DRY_RUN");
  assert.deepEqual(await counts(), before, "dry-run tidak menulis apa pun");

  const first = await runTerminalCompletedRouteReconciliation(testPrisma, { apply: true });
  assert.equal(first.terminal.replayed, false);
  const state = await testPrisma.deliveryRouteState.findUnique({ where: { routeId: fx.route.id } });
  assert.equal(state.lifecycleStatus, "COMPLETED");
  assert.equal(state.currentPublicationVersion, 2);
  const publications = await testPrisma.routePublication.findMany({ where: { routeId: fx.route.id }, include: { assignments: true }, orderBy: { publicationVersion: "asc" } });
  assert.deepEqual(publications.map((item) => item.status), ["REVOKED", "REVOKED"]);
  assert.equal(publications.every((item) => item.assignments.every((a) => a.status === "REVOKED")), true);

  const after = await counts();
  assert.equal(after.commands, before.commands + 1);
  assert.equal(after.publications, before.publications + 1);
  assert.equal(after.outbox, before.outbox + 1, "tepat satu outbox event");
  const feed = await testPrisma.driverSyncEvent.findMany({ orderBy: [{ userId: "asc" }, { sequence: "asc" }] });
  assert.deepEqual(feed.map((item) => item.kind), ["REMOVE_ROUTE", "REMOVE_ROUTE"], "satu tombstone per anggota crew");
  assert.deepEqual(feed.map((item) => item.userId).sort(), [fx.driver.id, fx.helper.id].sort());

  const v1After = JSON.stringify({
    route: await testPrisma.route.findUnique({ where: { id: fx.route.id } }),
    jobs: await testPrisma.job.findMany({ where: { routeId: fx.route.id }, orderBy: { id: "asc" } }),
  });
  assert.equal(v1After, v1Before, "V1 (route dan 8 job terminal) tidak berubah");

  const replay = await runTerminalCompletedRouteReconciliation(testPrisma, { apply: true });
  assert.equal(replay.terminal.replayed, true);
  assert.deepEqual(await counts(), after, "replay tidak menambah baris apa pun");
});
