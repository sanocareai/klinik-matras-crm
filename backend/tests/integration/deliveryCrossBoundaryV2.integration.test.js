import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUnit, createTestUser } from "./setup/fixtures.js";
import { ensurePickupJobForOrder } from "../../src/services/armadaAutoJob.js";
import { suggestDeliveryJob } from "../../src/services/deliveryHandoff.js";
import { createDeliveryTask } from "../../src/services/complaintCase.js";
import { selesaikanJobBelumJalan } from "../../src/services/orderStatusSync.js";
import {
  assertLegacyDeliveryJobDeleteAllowed,
  assertLegacyDeliveryRepairAllowed,
  executeDeliveryCrossBoundaryCommand,
} from "../../src/services/deliveryCrossBoundaryCommandService.js";
import {
  DELIVERY_V2_ROUTE_INCLUDE,
  buildDeliveryRouteSnapshot,
  deliveryJobSource,
  deliveryV2Checksum,
} from "../../src/services/deliveryV2Snapshot.js";
import { V2_FLAGS } from "../../src/services/v2FeatureFlags.js";

async function setFlag(key, enabled) {
  await testPrisma.v2FeatureFlag.upsert({
    where: { key },
    create: { key, enabled, scope: "GLOBAL", config: {}, reason: "integration test" },
    update: { enabled, scope: "GLOBAL", config: {}, reason: "integration test" },
  });
}

async function enableWriters() {
  await setFlag(V2_FLAGS.DELIVERY_ROUTE_WRITER, true);
  await setFlag(V2_FLAGS.DELIVERY_EXECUTION_WRITER, true);
  await setFlag(V2_FLAGS.DRIVER_SNAPSHOT_READER, false);
  await setFlag(V2_FLAGS.DELIVERY_WEB_READER, false);
  await setFlag(V2_FLAGS.DELIVERY_V1_WRITER_FENCE, false);
}

async function disableAllFlags() {
  await testPrisma.v2FeatureFlag.updateMany({ data: { enabled: false } });
}

async function seedPublishedRoute({ driverId }) {
  const customer = await testPrisma.customer.create({ data: { name: "Cross Boundary Route" } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, value: 0 } });
  const route = await testPrisma.route.create({
    data: {
      code: `CB-${Date.now()}-${Math.random()}`,
      date: new Date("2026-09-24T00:00:00.000Z"),
      status: "PUBLISHED",
      publishedAt: new Date(),
      driverId,
    },
  });
  const job = await testPrisma.job.create({
    data: { type: "DELIVERY", orderId: order.id, routeId: route.id, driverId, status: "ASSIGNED", sequence: 1 },
  });
  const jobChecksum = deliveryV2Checksum(deliveryJobSource(job));
  await testPrisma.deliveryJobState.create({
    data: { jobId: job.id, jobRevision: 1, currentStatus: job.status, sourceChecksum: jobChecksum, migrationSource: "TEST_BASELINE" },
  });
  const fullRoute = await testPrisma.route.findUniqueOrThrow({ where: { id: route.id }, include: DELIVERY_V2_ROUTE_INCLUDE });
  const snapshot = buildDeliveryRouteSnapshot(fullRoute, { routeRevision: 1, publicationVersion: 1 });
  const checksum = deliveryV2Checksum(snapshot);
  await testPrisma.deliveryRouteState.create({
    data: {
      routeId: route.id,
      routeRevision: 1,
      currentPublicationVersion: 1,
      lifecycleStatus: route.status,
      draftSnapshot: snapshot,
      draftChecksum: checksum,
      sourceChecksum: checksum,
      migrationSource: "TEST_BASELINE",
    },
  });
  await testPrisma.routePublication.create({
    data: {
      routeId: route.id,
      publicationVersion: 1,
      routeRevision: 1,
      status: "ACTIVE",
      snapshot,
      checksum,
      migrationBaseline: true,
      assignments: {
        create: [{
          jobId: job.id,
          sequence: 1,
          driverId,
          status: "ACTIVE",
          sourceChecksum: deliveryV2Checksum(snapshot.stops[0]),
        }],
      },
    },
  });
  return { order, route, job };
}

test.before(async () => {
  await truncateAll();
  await disableAllFlags();
});

test.afterEach(async () => {
  await disableAllFlags();
  await truncateAll();
});

test.after(async () => {
  await disableAllFlags();
  await truncateAll();
  await testPrisma.$disconnect();
});

test("auto-job pickup dan handoff Production membuat V1 + V2 atomik saat writer aktif", async () => {
  await enableWriters();

  const pickupFixture = await createTestUnit({ status: "AWAITING_PICKUP" });
  const pickupOrder = await testPrisma.order.update({
    where: { id: pickupFixture.order.id },
    data: { deliveryAddress: "Alamat Pickup", deliveryCity: "Jakarta" },
  });
  const pickupJobId = await testPrisma.$transaction((tx) => ensurePickupJobForOrder(tx, pickupOrder));
  const pickupJob = await testPrisma.job.findUniqueOrThrow({ where: { id: pickupJobId } });
  const pickupState = await testPrisma.deliveryJobState.findUniqueOrThrow({ where: { jobId: pickupJobId } });
  assert.equal(pickupJob.type, "PICKUP");
  assert.equal(pickupState.currentStatus, pickupJob.status);
  assert.equal(await testPrisma.v2Command.count({ where: { commandType: "AUTO_PICKUP_JOB_CREATE" } }), 1);

  const handoffFixture = await createTestUnit({ status: "READY_FOR_DELIVERY" });
  await testPrisma.$transaction((tx) => suggestDeliveryJob(tx, handoffFixture.unit.id));
  const handoffJob = await testPrisma.job.findFirstOrThrow({
    where: { orderId: handoffFixture.order.id, type: "DELIVERY" },
  });
  assert.ok(await testPrisma.deliveryJobState.findUnique({ where: { jobId: handoffJob.id } }));
  assert.equal(await testPrisma.v2Command.count({ where: { commandType: "PRODUCTION_DELIVERY_HANDOFF_CREATE" } }), 1);
});

test("complaint delivery-task memakai command owner yang sama tanpa mengubah kontrak kasus", async () => {
  await enableWriters();
  const actor = await createTestUser({ roles: ["DISPATCHER"] });
  const fixture = await createTestUnit({ status: "IN_PRODUCTION" });
  const complaint = await testPrisma.complaintCase.create({
    data: {
      caseNumber: `CMP-CB-${Date.now()}`,
      orderId: fixture.order.id,
      unitId: fixture.unit.id,
      category: "KENYAMANAN",
      severity: "TINGGI",
      description: "Fixture cross-boundary",
      status: "ACTION_REQUIRED",
      currentOwner: "SALES",
    },
  });

  const result = await createDeliveryTask(complaint.id, { jobType: "PICKUP", accessNotes: "Ambil unit" }, actor.user.id);
  assert.equal(result.status, "DIJADWALKAN");
  assert.equal(result.currentOwner, "DELIVERY");
  assert.equal(result.jobs.length, 1);
  assert.ok(await testPrisma.deliveryJobState.findUnique({ where: { jobId: result.jobs[0].id } }));
  assert.equal(await testPrisma.v2Command.count({ where: { commandType: "COMPLAINT_DELIVERY_TASK_CREATE" } }), 1);
});

test("order aktif yang menutup job ikut menerbitkan publication baru sebelum commit", async () => {
  await enableWriters();
  const driver = await createTestUser({ roles: ["DRIVER"] });
  const fixture = await seedPublishedRoute({ driverId: driver.user.id });

  await testPrisma.$transaction((tx) => selesaikanJobBelumJalan(tx, fixture.order.id));

  const [job, route, state, publications] = await Promise.all([
    testPrisma.job.findUniqueOrThrow({ where: { id: fixture.job.id } }),
    testPrisma.route.findUniqueOrThrow({ where: { id: fixture.route.id } }),
    testPrisma.deliveryRouteState.findUniqueOrThrow({ where: { routeId: fixture.route.id } }),
    testPrisma.routePublication.findMany({ where: { routeId: fixture.route.id }, orderBy: { publicationVersion: "asc" } }),
  ]);
  assert.equal(job.status, "COMPLETED");
  assert.equal(route.status, "COMPLETED");
  assert.equal(state.routeRevision, 2);
  assert.equal(state.currentPublicationVersion, 2);
  assert.deepEqual(publications.map((item) => item.status), ["SUPERSEDED", "ACTIVE"]);
  assert.equal(publications[1].snapshot.status, "COMPLETED");
});

test("fault setelah projection V1 me-rollback V1, V2Command, dan outbox bersama", async () => {
  await enableWriters();
  const fixture = await createTestUnit({ status: "READY_FOR_DELIVERY" });
  const job = await testPrisma.job.create({
    data: { type: "DELIVERY", orderId: fixture.order.id, status: "UNSCHEDULED" },
  });
  const checksum = deliveryV2Checksum(deliveryJobSource(job));
  await testPrisma.deliveryJobState.create({
    data: { jobId: job.id, jobRevision: 1, currentStatus: job.status, sourceChecksum: checksum },
  });
  const commandCountBefore = await testPrisma.v2Command.count();

  await assert.rejects(
    testPrisma.$transaction((tx) => executeDeliveryCrossBoundaryCommand(tx, {
      commandType: "FAULT_INJECTION_CROSS_BOUNDARY",
      aggregateHint: job.id,
      mutate: async (commandTx) => {
        await commandTx.job.update({ where: { id: job.id }, data: { addressText: "MUST_ROLL_BACK" } });
        return { jobIds: [randomUUID()] };
      },
    })),
    (error) => error.code === "DELIVERY_JOB_DISAPPEARED",
  );
  assert.equal((await testPrisma.job.findUniqueOrThrow({ where: { id: job.id } })).addressText, null);
  assert.equal(await testPrisma.v2Command.count(), commandCountBefore);
  assert.equal(await testPrisma.domainOutbox.count(), 0);
});

test("repair apply dan hard-delete legacy ditolak ketika writer V2 aktif", async () => {
  await enableWriters();
  await assert.rejects(
    assertLegacyDeliveryRepairAllowed(testPrisma, "fixture-repair.js"),
    (error) => error.code === "LEGACY_DELIVERY_REPAIR_FENCED" && error.statusCode === 503,
  );
  await assert.rejects(
    testPrisma.$transaction((tx) => assertLegacyDeliveryJobDeleteAllowed(tx, {
      operation: "FIXTURE_DELETE",
      jobIds: [randomUUID()],
    })),
    (error) => error.code === "HISTORICAL_DATA_PROTECTED" && error.statusCode === 409,
  );
});
