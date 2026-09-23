import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { cancelOrderDeliveryJobs } from "../../src/services/deliveryJobCancellationService.js";
import {
  DELIVERY_V2_ROUTE_INCLUDE,
  buildDeliveryRouteSnapshot,
  deliveryJobSource,
  deliveryV2Checksum,
} from "../../src/services/deliveryV2Snapshot.js";
import { readDriverDelta, readDriverFullSnapshot } from "../../src/services/driverSnapshotV2.js";
import { V2_FLAGS } from "../../src/services/v2FeatureFlags.js";

const CURSOR_SECRET = "delivery-cancel-test-secret";
let server;

async function setFlag(key, enabled) {
  await testPrisma.v2FeatureFlag.upsert({
    where: { key },
    create: { key, enabled, scope: "GLOBAL", config: {}, reason: "cancellation integration test" },
    update: { enabled, scope: "GLOBAL", config: {}, reason: "cancellation integration test" },
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

async function seedRoute({
  driverId,
  routeStatus = "PUBLISHED",
  jobStatus = "ASSIGNED",
  proofPhotoUrls = [],
  podStatus = null,
}) {
  const customer = await testPrisma.customer.create({ data: { name: `Cancel ${Date.now()} ${Math.random()}` } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, value: 0 } });
  const route = await testPrisma.route.create({
    data: {
      code: `CXL-${Date.now()}-${Math.random()}`,
      date: new Date("2026-09-24T00:00:00.000Z"),
      status: routeStatus,
      publishedAt: routeStatus === "DRAFT" ? null : new Date(),
      driverId,
    },
  });
  const job = await testPrisma.job.create({
    data: {
      type: "DELIVERY",
      orderId: order.id,
      routeId: route.id,
      driverId,
      scheduledDate: new Date("2026-09-24T00:00:00.000Z"),
      status: jobStatus,
      sequence: 1,
      proofPhotoUrls,
      podStatus,
    },
  });
  await testPrisma.deliveryJobState.create({
    data: {
      jobId: job.id,
      jobRevision: 1,
      currentStatus: job.status,
      sourceChecksum: deliveryV2Checksum(deliveryJobSource(job)),
      migrationSource: "TEST_BASELINE",
    },
  });
  const fullRoute = await testPrisma.route.findUniqueOrThrow({
    where: { id: route.id },
    include: DELIVERY_V2_ROUTE_INCLUDE,
  });
  const publicationVersion = routeStatus === "DRAFT" ? null : 1;
  const snapshot = buildDeliveryRouteSnapshot(fullRoute, { routeRevision: 1, publicationVersion });
  const checksum = deliveryV2Checksum(snapshot);
  await testPrisma.deliveryRouteState.create({
    data: {
      routeId: route.id,
      routeRevision: 1,
      currentPublicationVersion: publicationVersion,
      lifecycleStatus: route.status,
      draftSnapshot: snapshot,
      draftChecksum: checksum,
      sourceChecksum: checksum,
      migrationSource: "TEST_BASELINE",
    },
  });
  if (publicationVersion) {
    await testPrisma.routePublication.create({
      data: {
        routeId: route.id,
        publicationVersion,
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
            status: ["COMPLETED", "FAILED", "RESCHEDULED"].includes(job.status) ? "COMPLETED" : "ACTIVE",
            sourceChecksum: deliveryV2Checksum(snapshot.stops[0]),
          }],
        },
      },
    });
  }
  return { customer, order, route, job };
}

async function postCancel(orderId, token, reason = "Customer membatalkan") {
  const response = await fetch(`${server.baseUrl}/api/orders/${orderId}/cancel`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });
  return { response, body: await response.json() };
}

test.before(async () => {
  await truncateAll();
  await disableAllFlags();
  server = await startTestServer(buildTestApp());
});

test.afterEach(async () => {
  await disableAllFlags();
  await truncateAll();
});

test.after(async () => {
  await server.close();
  await disableAllFlags();
  await truncateAll();
  await testPrisma.$disconnect();
});

test("order cancellation sebelum publish membuat tombstone tanpa hard-delete dan idempotent", async () => {
  await enableWriters();
  const sales = await createTestUser({ roles: ["SALES"] });
  const driver = await createTestUser({ roles: ["DRIVER"] });
  const fixture = await seedRoute({ driverId: driver.user.id, routeStatus: "DRAFT", jobStatus: "ASSIGNED", proofPhotoUrls: ["/media/job-photos/keep.jpg"] });

  const first = await postCancel(fixture.order.id, sales.token, "Customer batal sebelum berangkat");
  assert.equal(first.response.status, 200);
  assert.equal(first.body.id, fixture.order.id);
  assert.equal(first.body.status, "CANCELLED");

  const [job, tombstone, state, routeState, execution] = await Promise.all([
    testPrisma.job.findUniqueOrThrow({ where: { id: fixture.job.id } }),
    testPrisma.deliveryJobCancellation.findUniqueOrThrow({ where: { jobId: fixture.job.id } }),
    testPrisma.deliveryJobState.findUniqueOrThrow({ where: { jobId: fixture.job.id } }),
    testPrisma.deliveryRouteState.findUniqueOrThrow({ where: { routeId: fixture.route.id } }),
    testPrisma.deliveryExecutionEvent.findUniqueOrThrow({ where: { idempotencyKey: `order-cancel:${fixture.order.id}:${fixture.job.id}` } }),
  ]);
  assert.equal(job.status, "FAILED");
  assert.equal(job.routeId, fixture.route.id);
  assert.deepEqual(job.proofPhotoUrls, ["/media/job-photos/keep.jpg"]);
  assert.equal(tombstone.previousStatus, "ASSIGNED");
  assert.equal(tombstone.reason, "Customer batal sebelum berangkat");
  assert.equal(tombstone.actorId, sales.user.id);
  assert.equal(state.currentStatus, "CANCELLED");
  assert.deepEqual(routeState.draftSnapshot.stops, []);
  assert.equal(routeState.currentPublicationVersion, null);
  assert.equal(execution.action, "JOB_CANCELLED_BY_ORDER");
  await assert.rejects(
    testPrisma.deliveryJobCancellation.update({
      where: { jobId: fixture.job.id },
      data: { reason: "MUST_NOT_CHANGE" },
    }),
    /immutable/i,
  );

  const myJobs = await fetch(`${server.baseUrl}/api/armada/my-jobs?date=2026-09-24`, {
    headers: { Authorization: `Bearer ${driver.token}` },
  });
  assert.equal(myJobs.status, 200);
  assert.deepEqual((await myJobs.json()).jobs, []);

  const second = await postCancel(fixture.order.id, sales.token, "Retry yang tidak boleh menimpa alasan");
  assert.equal(second.response.status, 200);
  assert.equal(second.body.status, "CANCELLED");
  assert.equal(await testPrisma.deliveryJobCancellation.count({ where: { jobId: fixture.job.id } }), 1);
  assert.equal((await testPrisma.deliveryJobCancellation.findUniqueOrThrow({ where: { jobId: fixture.job.id } })).reason, "Customer batal sebelum berangkat");
});

test("PATCH status Sales mempertahankan kontrak respons dan memakai command owner yang sama", async () => {
  await enableWriters();
  const sales = await createTestUser({ roles: ["SALES"] });
  const driver = await createTestUser({ roles: ["DRIVER"] });
  const fixture = await seedRoute({ driverId: driver.user.id, routeStatus: "DRAFT", jobStatus: "SCHEDULED" });

  const response = await fetch(`${server.baseUrl}/api/orders/${fixture.order.id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${sales.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ status: "CANCELLED", statusOverrideNote: "Batal dari dropdown Sales" }),
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.id, fixture.order.id);
  assert.equal(body.status, "CANCELLED");
  const tombstone = await testPrisma.deliveryJobCancellation.findUniqueOrThrow({ where: { jobId: fixture.job.id } });
  assert.equal(tombstone.reason, "Batal dari dropdown Sales");
  assert.equal(tombstone.actorId, sales.user.id);
  assert.equal(await testPrisma.v2Command.count({ where: { commandType: "ORDER_CANCEL_DELIVERY_JOBS" } }), 1);
});

test("setelah publish, assignment ditutup dan driver offline menerima REMOVE_ROUTE + REMOVE_JOB berurutan", async () => {
  await enableWriters();
  const driver = await createTestUser({ roles: ["DRIVER"] });
  const fixture = await seedRoute({ driverId: driver.user.id, routeStatus: "PUBLISHED", jobStatus: "ASSIGNED" });
  const before = await readDriverFullSnapshot(testPrisma, { userId: driver.user.id, secret: CURSOR_SECRET });
  assert.equal(before.items.length, 1);

  await testPrisma.$transaction((tx) => cancelOrderDeliveryJobs(tx, {
    orderId: fixture.order.id,
    actorId: "SYSTEM",
    reason: "Order batal setelah publish",
  }));

  const publications = await testPrisma.routePublication.findMany({
    where: { routeId: fixture.route.id },
    orderBy: { publicationVersion: "asc" },
    include: { assignments: true },
  });
  assert.equal(publications.length, 2);
  assert.equal(publications[0].status, "SUPERSEDED");
  assert.equal(publications[0].assignments[0].status, "REVOKED");
  assert.deepEqual(publications[1].snapshot.stops, []);
  assert.deepEqual(publications[1].assignments, []);

  const delta = await readDriverDelta(testPrisma, { userId: driver.user.id, cursor: before.deltaCursor, secret: CURSOR_SECRET });
  assert.equal(delta.mode, "DELTA");
  assert.deepEqual(delta.events.map((event) => event.kind), ["REMOVE_ROUTE", "REMOVE_JOB"]);
  assert.equal(delta.events[1].payload.jobId, fixture.job.id);

  const after = await readDriverFullSnapshot(testPrisma, { userId: driver.user.id, secret: CURSOR_SECRET });
  assert.deepEqual(after.items, []);
  assert.ok(await testPrisma.domainOutbox.findUnique({ where: { dedupeKey: `delivery-job-cancelled:${(await testPrisma.deliveryJobCancellation.findUniqueOrThrow({ where: { jobId: fixture.job.id } })).id}` } }));
});

test("route berjalan dapat dibatalkan tanpa menghapus bukti atau referensi historis", async () => {
  await enableWriters();
  const driver = await createTestUser({ roles: ["DRIVER"] });
  const fixture = await seedRoute({
    driverId: driver.user.id,
    routeStatus: "IN_PROGRESS",
    jobStatus: "EN_ROUTE",
    proofPhotoUrls: ["/media/job-photos/en-route-proof.jpg"],
  });

  await testPrisma.$transaction((tx) => cancelOrderDeliveryJobs(tx, {
    orderId: fixture.order.id,
    actorId: driver.user.id,
    reason: "Customer membatalkan saat perjalanan",
  }));

  const job = await testPrisma.job.findUniqueOrThrow({ where: { id: fixture.job.id } });
  const tombstone = await testPrisma.deliveryJobCancellation.findUniqueOrThrow({ where: { jobId: fixture.job.id } });
  assert.equal(job.status, "FAILED");
  assert.equal(job.routeId, fixture.route.id);
  assert.equal(job.driverId, driver.user.id);
  assert.deepEqual(job.proofPhotoUrls, ["/media/job-photos/en-route-proof.jpg"]);
  assert.equal(tombstone.previousStatus, "EN_ROUTE");
  assert.equal(tombstone.previousRouteId, fixture.route.id);
  assert.equal(tombstone.previousDriverId, driver.user.id);
});

test("Job selesai tetap utuh ketika order dibatalkan", async () => {
  await enableWriters();
  const sales = await createTestUser({ roles: ["SALES"] });
  const driver = await createTestUser({ roles: ["DRIVER"] });
  const fixture = await seedRoute({ driverId: driver.user.id, routeStatus: "COMPLETED", jobStatus: "COMPLETED", proofPhotoUrls: ["/media/job-photos/final.jpg"] });

  const result = await postCancel(fixture.order.id, sales.token, "Order administratif ditutup");
  assert.equal(result.response.status, 200);
  const job = await testPrisma.job.findUniqueOrThrow({ where: { id: fixture.job.id } });
  assert.equal(job.status, "COMPLETED");
  assert.deepEqual(job.proofPhotoUrls, ["/media/job-photos/final.jpg"]);
  assert.equal(await testPrisma.deliveryJobCancellation.count({ where: { jobId: fixture.job.id } }), 0);
});

test("state tidak konsisten yang tidak aman menghasilkan konflik spesifik tanpa mutation", async () => {
  await enableWriters();
  const sales = await createTestUser({ roles: ["SALES"] });
  const driver = await createTestUser({ roles: ["DRIVER"] });
  const fixture = await seedRoute({ driverId: driver.user.id, routeStatus: "COMPLETED", jobStatus: "ASSIGNED" });

  const result = await postCancel(fixture.order.id, sales.token, "Jangan tebak state tidak konsisten");
  assert.equal(result.response.status, 409);
  assert.match(result.body.error, /rute yang sudah selesai/i);
  assert.equal((await testPrisma.order.findUniqueOrThrow({ where: { id: fixture.order.id } })).status, "PENDING");
  assert.equal((await testPrisma.job.findUniqueOrThrow({ where: { id: fixture.job.id } })).status, "ASSIGNED");
  assert.equal(await testPrisma.deliveryJobCancellation.count(), 0);
});

test("rollback caller membatalkan tombstone, projection, publication, feed, dan outbox bersama", async () => {
  await enableWriters();
  const driver = await createTestUser({ roles: ["DRIVER"] });
  const fixture = await seedRoute({ driverId: driver.user.id, routeStatus: "PUBLISHED", jobStatus: "ASSIGNED" });

  await assert.rejects(
    testPrisma.$transaction(async (tx) => {
      await cancelOrderDeliveryJobs(tx, { orderId: fixture.order.id, actorId: "SYSTEM", reason: "MUST_ROLL_BACK" });
      throw new Error("FAULT_AFTER_CANCELLATION");
    }),
    /FAULT_AFTER_CANCELLATION/,
  );

  assert.equal((await testPrisma.job.findUniqueOrThrow({ where: { id: fixture.job.id } })).status, "ASSIGNED");
  assert.equal(await testPrisma.deliveryJobCancellation.count(), 0);
  assert.equal(await testPrisma.routePublication.count({ where: { routeId: fixture.route.id } }), 1);
  assert.equal(await testPrisma.driverSyncEvent.count({ where: { userId: driver.user.id } }), 0);
  assert.equal(await testPrisma.domainOutbox.count(), 0);
  assert.equal(await testPrisma.v2Command.count({ where: { commandType: "ORDER_CANCEL_DELIVERY_JOBS" } }), 0);
});
