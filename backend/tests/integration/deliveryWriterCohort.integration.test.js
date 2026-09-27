import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { applyPlan, buildExceptions, loadSource, unitPlan } from "../../scripts/production-delivery-v2/backfill-core.js";
import { executeDeliveryCrossBoundaryCommand } from "../../src/services/deliveryCrossBoundaryCommandService.js";
import { V2_FLAGS } from "../../src/services/v2FeatureFlags.js";

const HARI_INI = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
const DATE = new Date(`${HARI_INI}T00:00:00.000Z`);
let server;

test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });
test.afterEach(async () => { await truncateAll(); });

async function setWriters({ route, execution }) {
  for (const [key, value] of [[V2_FLAGS.DELIVERY_ROUTE_WRITER, route], [V2_FLAGS.DELIVERY_EXECUTION_WRITER, execution]]) {
    const data = { enabled: value.enabled, scope: "GLOBAL", config: value.routeIds ? { routeIds: value.routeIds } : {}, reason: "writer cohort test" };
    await testPrisma.v2FeatureFlag.upsert({ where: { key }, create: { key, ...data }, update: data });
  }
  for (const key of [V2_FLAGS.DRIVER_SNAPSHOT_READER, V2_FLAGS.DELIVERY_WEB_READER, V2_FLAGS.DELIVERY_V1_WRITER_FENCE]) {
    await testPrisma.v2FeatureFlag.upsert({ where: { key }, create: { key, enabled: false, scope: "GLOBAL", config: {} }, update: { enabled: false } });
  }
}
const cohortOn = (routeIds) => setWriters({ route: { enabled: true, routeIds }, execution: { enabled: true, routeIds } });
const writersOff = () => setWriters({ route: { enabled: false }, execution: { enabled: false } });

async function world() {
  const [dispatcher, driver, helper] = await Promise.all([
    createTestUser({ roles: ["DISPATCHER"] }), createTestUser({ roles: ["DRIVER"] }), createTestUser({ roles: ["HELPER"] }),
  ]);
  const customer = await testPrisma.customer.create({ data: { name: "Cohort" } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, value: 0, status: "PROCESSING" } });
  const draft = async (code) => {
    const route = await testPrisma.route.create({ data: { code, status: "DRAFT", date: DATE, driverId: driver.user.id, helperId: helper.user.id } });
    const job = await testPrisma.job.create({ data: { type: "DELIVERY", orderId: order.id, routeId: route.id, status: "SCHEDULED", sequence: 1, scheduledDate: DATE } });
    return { route, job };
  };
  const canary = await draft(`CANARY-${Date.now()}`);
  const other = await draft(`OTHER-${Date.now()}`);
  const source = await loadSource(testPrisma); // baseline projection V2 seperti catch-up production
  await applyPlan(testPrisma, source, source.units.map(unitPlan), buildExceptions(source.units, source.routes, source.jobs));
  return { dispatcher, driver, helper, order, canary, other };
}

const commandsFor = (aggregateId) => testPrisma.v2Command.count({ where: { aggregateId } });
const totals = async () => ({
  commands: await testPrisma.v2Command.count(),
  outbox: await testPrisma.domainOutbox.count(),
  feed: await testPrisma.driverSyncEvent.count(),
  publications: await testPrisma.routePublication.count(),
});

test("7. dispatcher publish lalu driver berbeda mengeksekusi route cohort: keduanya lewat writer V2; route lain tetap V1", async () => {
  const w = await world();
  await cohortOn([w.canary.route.id]);
  const dispatcher = makeClient(server.baseUrl, w.dispatcher.token);

  const publishCanary = await dispatcher.post(`/api/armada/routes/${w.canary.route.id}/publish`, {}, { "Idempotency-Key": "canary-publish-1" });
  assert.equal(publishCanary.status, 200, JSON.stringify(publishCanary.body));
  assert.equal(await commandsFor(w.canary.route.id), 1, "publish route cohort tercatat sebagai satu command V2");
  const state = await testPrisma.deliveryRouteState.findUnique({ where: { routeId: w.canary.route.id } });
  assert.equal(state.lifecycleStatus, "PUBLISHED");
  assert.ok(state.currentPublicationVersion >= 1);

  const publishOther = await dispatcher.post(`/api/armada/routes/${w.other.route.id}/publish`, {}, { "Idempotency-Key": "other-publish-1" });
  assert.equal(publishOther.status, 200, JSON.stringify(publishOther.body));
  assert.equal(await commandsFor(w.other.route.id), 0, "route di luar cohort tetap V1-only");
  assert.equal((await testPrisma.route.findUnique({ where: { id: w.other.route.id } })).status, "PUBLISHED", "V1 tetap berjalan normal");

  // Driver (user berbeda, tidak ada di userIds apa pun) memulai job di route cohort.
  const driver = makeClient(server.baseUrl, w.driver.token);
  const start = await driver.post(`/api/armada/jobs/${w.canary.job.id}/start`, { proofPhotoUrls: [] }, { "Idempotency-Key": "canary-start-1" });
  assert.equal(start.status, 200, JSON.stringify(start.body));
  assert.equal(await commandsFor(w.canary.job.id), 1, "eksekusi driver tercatat sebagai command V2 (route di-resolve dari job)");
  const jobState = await testPrisma.deliveryJobState.findUnique({ where: { jobId: w.canary.job.id } });
  assert.equal(jobState.currentStatus, "EN_ROUTE");

  // 10a. replay dengan Idempotency-Key sama: tidak menambah command/outbox/feed/publication.
  const before = await totals();
  const replay = await driver.post(`/api/armada/jobs/${w.canary.job.id}/start`, { proofPhotoUrls: [] }, { "Idempotency-Key": "canary-start-1" });
  assert.ok(replay.status < 500, JSON.stringify(replay.body));
  assert.deepEqual(await totals(), before);

  // Job route di luar cohort: eksekusi tetap V1-only.
  const startOther = await driver.post(`/api/armada/jobs/${w.other.job.id}/start`, { proofPhotoUrls: [] }, { "Idempotency-Key": "other-start-1" });
  assert.equal(startOther.status, 200, JSON.stringify(startOther.body));
  assert.equal(await commandsFor(w.other.job.id), 0);

  // 10b. rollback writer ke V1-only: mutasi berikutnya pada route cohort tidak membuat command baru; V1 tetap jalan.
  await writersOff();
  const commandsBefore = await testPrisma.v2Command.count();
  const arrive = await driver.post(`/api/armada/jobs/${w.canary.job.id}/arrive`, {}, { "Idempotency-Key": "canary-arrive-after-rollback" });
  assert.equal(arrive.status, 200, JSON.stringify(arrive.body));
  assert.equal((await testPrisma.job.findUnique({ where: { id: w.canary.job.id } })).status, "ARRIVED");
  assert.equal(await testPrisma.v2Command.count(), commandsBefore, "writer OFF: tidak ada command V2 baru");
  assert.ok(await testPrisma.routePublication.count() > 0, "projection V2 lama tidak dihapus saat rollback");
});

test("cross-boundary (Sales/system): route cohort diproyeksikan; route non-cohort dan job tanpa route tetap V1-only", async () => {
  const w = await world();
  await cohortOn([w.canary.route.id]);
  const mutateNote = (jobId) => async (tx) => {
    await tx.job.update({ where: { id: jobId }, data: { accessNotes: `catatan ${jobId.slice(0, 4)}` } });
    return { jobIds: [jobId], value: "ok" };
  };

  const outside = await testPrisma.$transaction((tx) => executeDeliveryCrossBoundaryCommand(tx, { commandType: "TEST_NOTE", mutate: mutateNote(w.other.job.id) }));
  assert.equal(outside, "ok");
  assert.equal(await testPrisma.v2Command.count({ where: { commandType: "TEST_NOTE" } }), 0);

  const loose = await testPrisma.job.create({ data: { type: "DELIVERY", orderId: w.order.id, status: "UNSCHEDULED" } });
  await testPrisma.$transaction((tx) => executeDeliveryCrossBoundaryCommand(tx, { commandType: "TEST_NOTE", mutate: mutateNote(loose.id) }));
  assert.equal(await testPrisma.v2Command.count({ where: { commandType: "TEST_NOTE" } }), 0, "system command tanpa route -> V1-only");

  await testPrisma.$transaction((tx) => executeDeliveryCrossBoundaryCommand(tx, { commandType: "TEST_NOTE", mutate: mutateNote(w.canary.job.id) }));
  const command = await testPrisma.v2Command.findFirst({ where: { commandType: "TEST_NOTE" } });
  assert.ok(command, "mutation yang menyentuh route cohort diproyeksikan lewat command V2");
  assert.deepEqual(command.response.routeIds, [w.canary.route.id]);
  assert.equal((await testPrisma.job.findUnique({ where: { id: w.canary.job.id } })).accessNotes.startsWith("catatan"), true);
});

test("pair tidak lengkap atau cohort berbeda: seluruh lifecycle V1-only", async () => {
  const w = await world();
  const dispatcher = makeClient(server.baseUrl, w.dispatcher.token);
  await setWriters({ route: { enabled: true, routeIds: [w.canary.route.id] }, execution: { enabled: false } });
  let response = await dispatcher.post(`/api/armada/routes/${w.canary.route.id}/publish`, {}, { "Idempotency-Key": "pair-1" });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(await testPrisma.v2Command.count(), 0);

  await setWriters({ route: { enabled: true, routeIds: [w.other.route.id] }, execution: { enabled: true, routeIds: [w.canary.route.id] } });
  response = await dispatcher.post(`/api/armada/routes/${w.other.route.id}/publish`, {}, { "Idempotency-Key": "pair-2" });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(await testPrisma.v2Command.count(), 0);
});
