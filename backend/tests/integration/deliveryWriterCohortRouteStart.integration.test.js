import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { applyPlan, buildExceptions, loadSource, unitPlan } from "../../scripts/production-delivery-v2/backfill-core.js";
import { V2_FLAGS } from "../../src/services/v2FeatureFlags.js";

const HARI_INI = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
const DATE = new Date(`${HARI_INI}T00:00:00.000Z`);
let server;

test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });
test.afterEach(async () => { await truncateAll(); });

async function cohortOn(routeIds) {
  for (const key of [V2_FLAGS.DELIVERY_ROUTE_WRITER, V2_FLAGS.DELIVERY_EXECUTION_WRITER]) {
    const data = { enabled: true, scope: "GLOBAL", config: { routeIds }, reason: "route start cohort test" };
    await testPrisma.v2FeatureFlag.upsert({ where: { key }, create: { key, ...data }, update: data });
  }
  for (const key of [V2_FLAGS.DRIVER_SNAPSHOT_READER, V2_FLAGS.DELIVERY_WEB_READER, V2_FLAGS.DELIVERY_V1_WRITER_FENCE]) {
    await testPrisma.v2FeatureFlag.upsert({ where: { key }, create: { key, enabled: false, scope: "GLOBAL", config: {} }, update: { enabled: false } });
  }
}

async function world() {
  const [dispatcher, driver, helper] = await Promise.all([
    createTestUser({ roles: ["DISPATCHER"] }), createTestUser({ roles: ["DRIVER"] }), createTestUser({ roles: ["HELPER"] }),
  ]);
  const customer = await testPrisma.customer.create({ data: { name: "Cohort start" } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, value: 0, status: "PROCESSING" } });
  const draft = async (code) => {
    const route = await testPrisma.route.create({ data: { code, status: "DRAFT", date: DATE, driverId: driver.user.id, helperId: helper.user.id } });
    for (let sequence = 1; sequence <= 2; sequence += 1) {
      await testPrisma.job.create({ data: { type: "DELIVERY", orderId: order.id, routeId: route.id, status: "SCHEDULED", sequence, scheduledDate: DATE } });
    }
    return route;
  };
  const canary = await draft(`CAN-${Date.now()}`);
  const other = await draft(`OTH-${Date.now()}`);
  const source = await loadSource(testPrisma);
  await applyPlan(testPrisma, source, source.units.map(unitPlan), buildExceptions(source.units, source.routes, source.jobs));
  return { dispatcher, driver, canary, other };
}

const snapshot = async () => ({
  commands: await testPrisma.v2Command.count(),
  outbox: await testPrisma.domainOutbox.count(),
  feed: await testPrisma.driverSyncEvent.count(),
  publications: await testPrisma.routePublication.count(),
  assignments: await testPrisma.routeStopAssignment.count(),
});
const diff = (a, b) => Object.fromEntries(Object.keys(a).map((key) => [key, b[key] - a[key]]));

test("publish lalu mulai route cohort lewat endpoint nyata: V2 tepat satu; non-cohort V1-only; replay tanpa data baru; routeId dari req.params", async () => {
  const w = await world();
  await cohortOn([w.canary.id]);
  const dispatcher = makeClient(server.baseUrl, w.dispatcher.token);
  const driver = makeClient(server.baseUrl, w.driver.token);

  for (const route of [w.canary, w.other]) {
    const response = await dispatcher.post(`/api/armada/routes/${route.id}/publish`, {}, { "Idempotency-Key": `publish-${route.code}` });
    assert.equal(response.status, 200, JSON.stringify(response.body));
  }

  // Mulai route cohort: payload klien menyelundupkan routeId non-cohort; yang dipakai harus req.params.id.
  const beforeStart = await snapshot();
  const start = await driver.post(`/api/armada/routes/${w.canary.id}/start`, { routeId: w.other.id, proofPhotoUrls: ["/media/job-photos/load.jpg"] }, { "Idempotency-Key": "canary-route-start" });
  assert.equal(start.status, 200, JSON.stringify(start.body));
  const afterStart = await snapshot();
  const delta = diff(beforeStart, afterStart);
  assert.equal(delta.commands, 1, "tepat satu command V2");
  const command = await testPrisma.v2Command.findFirst({ where: { idempotencyKey: "canary-route-start" } });
  assert.ok(command, "command memakai idempotency key klien");
  assert.equal(command.aggregateId, w.canary.id, "aggregate = route dari req.params.id, bukan payload");
  assert.equal(command.status, "APPLIED");
  assert.ok(delta.outbox >= 1, "outbox V2 tertulis");
  const outboxKeys = await testPrisma.domainOutbox.findMany({ select: { dedupeKey: true } });
  assert.equal(new Set(outboxKeys.map((row) => row.dedupeKey)).size, outboxKeys.length, "tidak ada dedupe key ganda");
  const state = await testPrisma.deliveryRouteState.findUnique({ where: { routeId: w.canary.id } });
  assert.equal(state.lifecycleStatus, "IN_PROGRESS");
  assert.equal((await testPrisma.route.findUnique({ where: { id: w.canary.id } })).status, "IN_PROGRESS");
  assert.equal((await testPrisma.route.findUnique({ where: { id: w.other.id } })).status, "PUBLISHED", "payload routeId tidak menyentuh route lain");

  // Replay: tidak menambah command/outbox/feed/publication/assignment.
  const replay = await driver.post(`/api/armada/routes/${w.canary.id}/start`, { routeId: w.other.id, proofPhotoUrls: ["/media/job-photos/load.jpg"] }, { "Idempotency-Key": "canary-route-start" });
  assert.ok(replay.status < 500, JSON.stringify(replay.body));
  assert.deepEqual(await snapshot(), afterStart);

  // Route non-cohort: V1 berjalan, tanpa command/outbox/feed V2.
  const otherStart = await driver.post(`/api/armada/routes/${w.other.id}/start`, { proofPhotoUrls: ["/media/job-photos/load.jpg"] }, { "Idempotency-Key": "other-route-start" });
  assert.equal(otherStart.status, 200, JSON.stringify(otherStart.body));
  assert.equal((await testPrisma.route.findUnique({ where: { id: w.other.id } })).status, "IN_PROGRESS");
  assert.deepEqual(diff(afterStart, await snapshot()), { commands: 0, outbox: 0, feed: 0, publications: 0, assignments: 0 });
  assert.equal(await testPrisma.v2Command.count({ where: { aggregateId: w.other.id } }), 0);
});
