import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { applyPlan, buildExceptions, loadSource, unitPlan } from "../../scripts/production-delivery-v2/backfill-core.js";
import { V2_FLAGS } from "../../src/services/v2FeatureFlags.js";

// Bukti Kelengkapan Standar (7 Okt 2026) — SELALU wajib minimal 1 foto
// sebelum POST /routes/:id/start bisa sukses (lihat routePrepChecklist.js);
// tes di file ini soal cohort writer V2, tidak soal checklist — kirim 1 foto
// seadanya supaya gerbang itu tidak mengganggu apa yang sebenarnya diuji.
async function kirimKelengkapan(token, routeId) {
  const fd = new FormData();
  fd.append("photos", new Blob([await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 1, g: 2, b: 3 } } }).jpeg().toBuffer()], { type: "image/jpeg" }), "k.jpg");
  const res = await fetch(`${server.baseUrl}/api/armada/routes/${routeId}/kelengkapan`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
  if (res.status !== 201) throw new Error(`gagal kirim kelengkapan fixture rute ${routeId}: ${res.status} ${await res.text()}`);
}

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

  // Publish route cohort: TEPAT satu command, satu event outbox, satu publication (bukan "minimal satu").
  const beforePublishCanary = await snapshot();
  const publishCanary = await dispatcher.post(`/api/armada/routes/${w.canary.id}/publish`, {}, { "Idempotency-Key": `publish-${w.canary.code}` });
  assert.equal(publishCanary.status, 200, JSON.stringify(publishCanary.body));
  const publishDelta = diff(beforePublishCanary, await snapshot());
  assert.equal(publishDelta.commands, 1, "publish cohort: tepat satu command");
  assert.equal(publishDelta.outbox, 1, "publish cohort: tepat satu event outbox");
  assert.equal(publishDelta.publications, 1, "publish cohort: tepat satu publication");
  assert.equal(await testPrisma.domainOutbox.count({ where: { aggregateId: w.canary.id } }), 1, "event outbox milik route cohort ini");
  // Publish route non-cohort: V1 saja, nol jejak V2.
  const beforePublishOther = await snapshot();
  const publishOther = await dispatcher.post(`/api/armada/routes/${w.other.id}/publish`, {}, { "Idempotency-Key": `publish-${w.other.code}` });
  assert.equal(publishOther.status, 200, JSON.stringify(publishOther.body));
  assert.deepEqual(diff(beforePublishOther, await snapshot()), { commands: 0, outbox: 0, feed: 0, publications: 0, assignments: 0 }, "publish non-cohort: V1-only");

  // Mulai route cohort: payload klien menyelundupkan routeId non-cohort; yang dipakai harus req.params.id.
  await kirimKelengkapan(w.driver.token, w.canary.id);
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
  assert.equal(delta.outbox, 1, "start cohort: tepat satu event outbox");
  assert.equal(delta.publications, 1, "start cohort: tepat satu publication (forcePublication)");
  assert.equal(await testPrisma.domainOutbox.count({ where: { aggregateId: w.canary.id } }), 2, "publish + start = dua event outbox untuk route cohort (masing-masing satu)");
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
  await kirimKelengkapan(w.driver.token, w.other.id);
  const otherStart = await driver.post(`/api/armada/routes/${w.other.id}/start`, { proofPhotoUrls: ["/media/job-photos/load.jpg"] }, { "Idempotency-Key": "other-route-start" });
  assert.equal(otherStart.status, 200, JSON.stringify(otherStart.body));
  assert.equal((await testPrisma.route.findUnique({ where: { id: w.other.id } })).status, "IN_PROGRESS");
  assert.deepEqual(diff(afterStart, await snapshot()), { commands: 0, outbox: 0, feed: 0, publications: 0, assignments: 0 });
  assert.equal(await testPrisma.v2Command.count({ where: { aggregateId: w.other.id } }), 0);
});

const NOL = { commands: 0, outbox: 0, feed: 0, publications: 0, assignments: 0 };
const FOTO = ["/media/job-photos/load.jpg"];
const cohortOff = async () => {
  for (const key of [V2_FLAGS.DELIVERY_ROUTE_WRITER, V2_FLAGS.DELIVERY_EXECUTION_WRITER]) {
    await testPrisma.v2FeatureFlag.upsert({ where: { key }, create: { key, enabled: false, scope: "GLOBAL", config: {}, reason: "writer OFF" }, update: { enabled: false, config: {} } });
  }
};
const jobDi = (routeId) => testPrisma.job.findFirst({ where: { routeId }, orderBy: { sequence: "asc" } });

test("payload routeId/aggregateId/routeIds/jobId yang BERLAWANAN diabaikan di publish, start rute, dan endpoint job: keputusan selalu dari req.params.id atau relasi server", async () => {
  const w = await world();
  await cohortOn([w.canary.id]);
  const dispatcher = makeClient(server.baseUrl, w.dispatcher.token);
  const driver = makeClient(server.baseUrl, w.driver.token);
  const jobCanary = await jobDi(w.canary.id);
  const jobOther = await jobDi(w.other.id);
  const rancu = (routeId, jobId) => ({ routeId, aggregateId: routeId, routeIds: [routeId], jobId, jobIds: [jobId], proofPhotoUrls: FOTO });

  // publish: params menentukan. Cohort dengan payload non-cohort => tetap V2; non-cohort dengan payload cohort => tetap V1.
  const b0 = await snapshot();
  const pc = await dispatcher.post(`/api/armada/routes/${w.canary.id}/publish`, rancu(w.other.id, jobOther.id), { "Idempotency-Key": "auth-publish-canary" });
  assert.equal(pc.status, 200, JSON.stringify(pc.body));
  // Satu command/outbox/publication per aksi; feed dan assignment ditulis PER STOP (route uji punya 2 stop).
  assert.deepEqual(diff(b0, await snapshot()), { commands: 1, outbox: 1, feed: 2, publications: 1, assignments: 2 }, "publish cohort dengan payload berlawanan: tetap tepat satu command/outbox/publication V2");
  assert.equal((await testPrisma.v2Command.findFirst({ where: { idempotencyKey: "auth-publish-canary" } })).aggregateId, w.canary.id);
  const b1 = await snapshot();
  const po = await dispatcher.post(`/api/armada/routes/${w.other.id}/publish`, rancu(w.canary.id, jobCanary.id), { "Idempotency-Key": "auth-publish-other" });
  assert.equal(po.status, 200, JSON.stringify(po.body));
  assert.deepEqual(diff(b1, await snapshot()), NOL, "publish non-cohort dengan payload cohort: tetap V1-only");

  // start rute: sama, kedua arah.
  await kirimKelengkapan(w.driver.token, w.other.id);
  const b2 = await snapshot();
  const so = await driver.post(`/api/armada/routes/${w.other.id}/start`, rancu(w.canary.id, jobCanary.id), { "Idempotency-Key": "auth-start-other" });
  assert.equal(so.status, 200, JSON.stringify(so.body));
  assert.deepEqual(diff(b2, await snapshot()), NOL, "start non-cohort dengan payload cohort: V1-only");
  assert.equal((await testPrisma.route.findUnique({ where: { id: w.canary.id } })).status, "PUBLISHED", "route cohort tidak ikut dimulai");
  await kirimKelengkapan(w.driver.token, w.canary.id);
  const b3 = await snapshot();
  const sc = await driver.post(`/api/armada/routes/${w.canary.id}/start`, rancu(w.other.id, jobOther.id), { "Idempotency-Key": "auth-start-canary" });
  assert.equal(sc.status, 200, JSON.stringify(sc.body));
  const d3 = diff(b3, await snapshot());
  assert.equal(d3.commands, 1, "start cohort dengan payload non-cohort: tepat satu command V2");
  assert.equal(d3.outbox, 1, "start cohort dengan payload non-cohort: tepat satu event outbox");
  assert.equal(d3.publications, 1, "start cohort dengan payload non-cohort: tepat satu publication");
  assert.equal((await testPrisma.v2Command.findFirst({ where: { idempotencyKey: "auth-start-canary" } })).aggregateId, w.canary.id);

  // endpoint job: route diselesaikan dari RELASI job di database, bukan payload.
  // job non-cohort + payload menunjuk route/job cohort => V1-only.
  const b4 = await snapshot();
  const jo = await driver.post(`/api/armada/jobs/${jobOther.id}/start`, rancu(w.canary.id, jobCanary.id), { "Idempotency-Key": "auth-job-other" });
  assert.ok(jo.status < 500, JSON.stringify(jo.body));
  assert.deepEqual(diff(b4, await snapshot()), NOL, "job non-cohort dengan payload cohort: V1-only (nol jejak V2)");
  assert.equal(await testPrisma.v2Command.count({ where: { aggregateId: jobOther.id } }), 0);
  // job cohort + payload menunjuk route/job non-cohort => tetap V2 pada route cohort dari relasi server.
  const b5 = await snapshot();
  const statusJobOtherSebelum = (await testPrisma.job.findUnique({ where: { id: jobOther.id } })).status;
  const jc = await driver.post(`/api/armada/jobs/${jobCanary.id}/start`, rancu(w.other.id, jobOther.id), { "Idempotency-Key": "auth-job-canary" });
  assert.ok(jc.status < 500, JSON.stringify(jc.body));
  const d5 = diff(b5, await snapshot());
  if (jc.status === 200) {
    assert.equal(d5.commands, 1, "job cohort dengan payload non-cohort: tepat satu command V2");
    const cmd = await testPrisma.v2Command.findFirst({ where: { idempotencyKey: "auth-job-canary" } });
    assert.equal(cmd.aggregateId, jobCanary.id, "aggregate = job dari req.params.id");
    assert.equal((await testPrisma.job.findUnique({ where: { id: jobOther.id } })).status, statusJobOtherSebelum, "job non-cohort (dari payload) tidak tersentuh oleh aksi pada job cohort");
  } else {
    assert.deepEqual(d5, NOL, "aksi job cohort ditolak: tidak ada efek V2 sebagian");
  }
});

test("setelah writer flag OFF: aksi berikutnya kembali V1-only dan tidak menambah command/outbox/feed/publication V2 (route dan job)", async () => {
  const w = await world();
  await cohortOn([w.canary.id]);
  const dispatcher = makeClient(server.baseUrl, w.dispatcher.token);
  const driver = makeClient(server.baseUrl, w.driver.token);
  const published = await dispatcher.post(`/api/armada/routes/${w.canary.id}/publish`, {}, { "Idempotency-Key": "off-publish-canary" });
  assert.equal(published.status, 200, JSON.stringify(published.body));
  assert.equal(await testPrisma.v2Command.count({ where: { aggregateId: w.canary.id } }), 1, "sebelum OFF: satu command V2");
  const projectionSebelumOff = await testPrisma.routePublication.count({ where: { routeId: w.canary.id } });

  await cohortOff(); // rollback writer: kembali V1-only

  await kirimKelengkapan(w.driver.token, w.canary.id);
  const sebelum = await snapshot();
  const start = await driver.post(`/api/armada/routes/${w.canary.id}/start`, { proofPhotoUrls: FOTO }, { "Idempotency-Key": "off-start-canary" });
  assert.equal(start.status, 200, JSON.stringify(start.body));
  assert.equal((await testPrisma.route.findUnique({ where: { id: w.canary.id } })).status, "IN_PROGRESS", "V1 tetap menjalankan aksi");
  assert.deepEqual(diff(sebelum, await snapshot()), NOL, "writer OFF: start route tidak menambah command/outbox/feed/publication/assignment");
  const jobCanary = await jobDi(w.canary.id);
  const jobStart = await driver.post(`/api/armada/jobs/${jobCanary.id}/start`, { proofPhotoUrls: [] }, { "Idempotency-Key": "off-job-canary" });
  assert.ok(jobStart.status < 500, JSON.stringify(jobStart.body));
  assert.deepEqual(diff(sebelum, await snapshot()), NOL, "writer OFF: aksi job juga V1-only");
  assert.equal(await testPrisma.v2Command.count({ where: { aggregateId: w.canary.id } }), 1, "tidak ada command V2 tambahan setelah OFF");
  assert.equal(await testPrisma.routePublication.count({ where: { routeId: w.canary.id } }), projectionSebelumOff, "projection V2 lama tidak dihapus");
  // route lain (tak pernah cohort) tetap V1-only setelah OFF
  const other = await dispatcher.post(`/api/armada/routes/${w.other.id}/publish`, {}, { "Idempotency-Key": "off-publish-other" });
  assert.equal(other.status, 200, JSON.stringify(other.body));
  assert.deepEqual(diff(sebelum, await snapshot()), NOL);
});
