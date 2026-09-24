import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { deliveryJobSource, deliveryV2Checksum } from "../../src/services/deliveryV2Snapshot.js";
import {
  revokeConfirmedRescheduledAssignment,
  revokeHistoricalFailedJobAssignment,
} from "../../src/services/historicalAssignmentRevocation.js";

async function seed({ routeStatus = "COMPLETED", orderStatus = "CANCELLED", jobId = undefined } = {}) {
  const { user: driver } = await createTestUser({ roles: ["DRIVER"] });
  const customer = await testPrisma.customer.create({ data: { name: "Historical assignment" } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, value: 0, status: orderStatus } });
  const route = await testPrisma.route.create({
    data: { code: `HIST-${Date.now()}-${Math.random()}`, date: new Date("2026-09-24T00:00:00.000Z"), status: routeStatus, driverId: driver.id },
  });
  const job = await testPrisma.job.create({
    data: { ...(jobId ? { id: jobId } : {}), type: "PICKUP", orderId: order.id, routeId: route.id, driverId: driver.id, status: "FAILED", sequence: 1 },
  });
  const jobChecksum = deliveryV2Checksum(deliveryJobSource(job));
  await testPrisma.deliveryJobState.create({
    data: { jobId: job.id, jobRevision: 3, currentStatus: "FAILED", sourceChecksum: jobChecksum, migrationSource: "TEST" },
  });
  const snapshot = { routeId: route.id, code: route.code, status: route.status, driverId: driver.id, stops: [{ jobId: job.id, sequence: 1 }] };
  await testPrisma.deliveryRouteState.create({
    data: { routeId: route.id, routeRevision: 4, currentPublicationVersion: 1, lifecycleStatus: route.status, draftSnapshot: snapshot, migrationSource: "TEST" },
  });
  await testPrisma.routePublication.create({
    data: {
      routeId: route.id, publicationVersion: 1, routeRevision: 4, status: "REVOKED", snapshot,
      checksum: deliveryV2Checksum(snapshot), migrationBaseline: true,
      assignments: { create: [{ jobId: job.id, sequence: 1, driverId: driver.id, status: "ACTIVE" }] },
    },
  });
  return { driver, customer, order, route, job };
}

test.beforeEach(async () => { await truncateAll(); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await testPrisma.$disconnect(); });

test("revoke histori atomik dan idempoten; semua aggregate bisnis tetap ada", async () => {
  const seeded = await seed({ jobId: "fbe92f99-db20-400c-ae8c-b61a42b01df6" });
  const input = {
    jobId: seeded.job.id,
    actorId: "OWNER_DECISION_TEST",
    idempotencyKey: "test-historical-revoke-fbe92f99",
    reason: "Owner approved test",
  };
  const first = await revokeHistoricalFailedJobAssignment(testPrisma, input);
  const replay = await revokeHistoricalFailedJobAssignment(testPrisma, input);
  assert.equal(first.revokedCount, 1);
  assert.equal(replay.replayed, true);
  assert.equal(await testPrisma.routeStopAssignment.count({ where: { jobId: seeded.job.id, status: "ACTIVE" } }), 0);
  assert.equal(await testPrisma.routeStopAssignment.count({ where: { jobId: seeded.job.id, status: "REVOKED" } }), 1);
  assert.deepEqual((await testPrisma.driverSyncEvent.findMany({ orderBy: { sequence: "asc" } })).map((event) => event.kind), ["REMOVE_JOB", "REMOVE_ROUTE"]);
  assert.equal(await testPrisma.activityEvent.count({ where: { entityId: seeded.job.id, eventType: "HISTORICAL_ASSIGNMENT_REVOKED" } }), 1);
  assert.equal(await testPrisma.domainOutbox.count({ where: { aggregateId: seeded.job.id, eventType: "delivery.assignment.historical.revoked" } }), 1);
  assert.equal(await testPrisma.v2Command.count({ where: { aggregateId: seeded.job.id, commandType: "REVOKE_HISTORICAL_FAILED_ASSIGNMENT" } }), 1);
  assert.equal(await testPrisma.job.count({ where: { id: seeded.job.id } }), 1);
  assert.equal(await testPrisma.route.count({ where: { id: seeded.route.id } }), 1);
  assert.equal(await testPrisma.order.count({ where: { id: seeded.order.id } }), 1);
  assert.equal(await testPrisma.customer.count({ where: { id: seeded.customer.id } }), 1);
});

test("route non-terminal ditolak dan transaksi tidak mencabut assignment", async () => {
  const seeded = await seed({ routeStatus: "PUBLISHED" });
  await assert.rejects(revokeHistoricalFailedJobAssignment(testPrisma, {
    jobId: seeded.job.id,
    actorId: "OWNER_DECISION_TEST",
    idempotencyKey: "test-historical-revoke-unsafe-route",
    reason: "must roll back",
  }), (error) => error.code === "HISTORICAL_REVOKE_NON_TERMINAL_ROUTE");
  assert.equal(await testPrisma.routeStopAssignment.count({ where: { jobId: seeded.job.id, status: "ACTIVE" } }), 1);
  assert.equal(await testPrisma.v2Command.count({ where: { aggregateId: seeded.job.id } }), 0);
  assert.equal(await testPrisma.driverSyncEvent.count(), 0);
  assert.equal(await testPrisma.domainOutbox.count(), 0);
});

test("reschedule 7d34 disiapkan dengan guard konfirmasi Ops dan replay idempoten", async () => {
  const { user: driver } = await createTestUser({ roles: ["DRIVER"] });
  const customer = await testPrisma.customer.create({ data: { name: "Reschedule historical assignment" } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, value: 0, status: "PICKUP" } });
  const oldRoute = await testPrisma.route.create({
    data: { code: "RTE-OLD-7D34", date: new Date("2026-09-24T00:00:00.000Z"), status: "COMPLETED", driverId: driver.id },
  });
  const job = await testPrisma.job.create({
    data: {
      id: "7d34e05d-b7f2-43cd-8842-31e13645492f",
      type: "PICKUP", orderId: order.id, status: "SCHEDULED",
      scheduledDate: new Date("2026-09-27T00:00:00.000Z"),
    },
  });
  await testPrisma.deliveryJobState.create({
    data: { jobId: job.id, jobRevision: 4, currentStatus: "SCHEDULED", migrationSource: "TEST" },
  });
  const snapshot = { routeId: oldRoute.id, code: oldRoute.code, status: "COMPLETED", driverId: driver.id, stops: [{ jobId: job.id, sequence: 1 }] };
  await testPrisma.routePublication.create({
    data: {
      routeId: oldRoute.id, publicationVersion: 1, routeRevision: 2,
      status: "REVOKED", snapshot, checksum: deliveryV2Checksum(snapshot),
      assignments: { create: [{ jobId: job.id, sequence: 1, driverId: driver.id, status: "ACTIVE" }] },
    },
  });
  const input = {
    jobId: job.id,
    actorId: "OPS_TEST",
    idempotencyKey: "confirmed-reschedule-7d34-test",
    reason: "Ops confirms final reschedule",
    confirmedScheduledDate: "2026-09-27",
    opsConfirmation: "RESCHEDULE_2026-09-27_FINAL",
  };
  await assert.rejects(revokeConfirmedRescheduledAssignment(testPrisma, {
    ...input, idempotencyKey: "unconfirmed-reschedule-7d34-test", opsConfirmation: null,
  }), (error) => error.code === "OPS_RESCHEDULE_CONFIRMATION_REQUIRED");
  assert.equal(await testPrisma.routeStopAssignment.count({ where: { jobId: job.id, status: "ACTIVE" } }), 1);
  const first = await revokeConfirmedRescheduledAssignment(testPrisma, input);
  const replay = await revokeConfirmedRescheduledAssignment(testPrisma, input);
  assert.equal(first.revokedCount, 1);
  assert.equal(replay.replayed, true);
  assert.equal(await testPrisma.routeStopAssignment.count({ where: { jobId: job.id, status: "REVOKED" } }), 1);
  assert.deepEqual((await testPrisma.driverSyncEvent.findMany({ orderBy: { sequence: "asc" } })).map((item) => item.kind), ["REMOVE_JOB", "REMOVE_ROUTE"]);
  const preserved = await testPrisma.job.findUnique({ where: { id: job.id } });
  assert.equal(preserved.status, "SCHEDULED");
  assert.equal(preserved.routeId, null);
  assert.equal(preserved.scheduledDate.toISOString().slice(0, 10), "2026-09-27");
  assert.equal(await testPrisma.route.count({ where: { id: oldRoute.id } }), 1);
  assert.equal(await testPrisma.order.count({ where: { id: order.id } }), 1);
});
